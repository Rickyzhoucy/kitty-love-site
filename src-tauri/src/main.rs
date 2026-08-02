// 桌面版外壳。
//
// ## 两个窗口，不是一个
//
// 以前只有一个窗口，「桌面模式」靠把页面内容藏掉来假装成桌宠——于是想看照片
// 就得让宠物窗口变回网页，**宠物就从桌面上消失了**。现在拆开：
//
// - `main`：站点本身，可以关、可以收进托盘
// - `pet` ：只有宠物，透明、置顶、无边框，主窗口没了它照样待在桌面上
//
// 两个窗口加载的是同一个站点的不同路由（`/` 和 `/desktop-pet`），共用同一份
// 会话 Cookie，所以只需要登录一次。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;

use settings::{DesktopSettings, SettingsState};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// 宠物窗口是否「已经真的是一只宠物了」。
///
/// **这个门闩是必须的。** 宠物窗口无边框、置顶、只有两百像素——它显示任何
/// 不是宠物的东西时都会变成一个甩不掉的浮块。第一版就栽在这儿：未登录时中间件
/// 把它重定向到登录页，于是一个填不了、也关不掉的登录框飘在所有窗口最上面。
///
/// 所以窗口一律**先建成隐藏的**，只有前端明确说「宠物挂上了、会话也有效」
/// 才显示。任何异常路径的结果都是「没有窗口」，而不是「一个奇怪的窗口」。
static PET_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

const CREDENTIAL_SERVICE: &str = "kitty-love-site";
const MAIN_LABEL: &str = "main";
const PET_LABEL: &str = "pet";
/// 必须和前端 `lib/desktopPet.ts` 里的 DESKTOP_PET_ROUTE 一致。
const PET_ROUTE: &str = "/desktop-pet";

// ── 凭据 ────────────────────────────────────────────────────────────────

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, "configured-server").map_err(|e| e.to_string())
}

#[tauri::command]
fn save_device_token(token: String) -> Result<(), String> {
    credential()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_device_token() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_device_token() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// ── 设置 ────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_desktop_settings(state: tauri::State<'_, SettingsState>) -> DesktopSettings {
    state.0.lock().unwrap().clone()
}

/// 前端改设置的唯一入口。改完立刻作用到窗口上并写盘——**不要求重启**，
/// 一个需要重启才生效的「锁定」开关等于没有。
#[tauri::command]
fn update_desktop_settings(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    next: DesktopSettings,
) -> Result<(), String> {
    {
        let mut current = state.0.lock().unwrap();
        *current = next.clone();
    }
    apply_settings(&app, &next);
    settings::save(&app, &next);
    let _ = app.emit("desktop-settings-changed", &next);
    Ok(())
}

/// 把设置落到真实窗口上。
fn apply_settings(app: &AppHandle, settings: &DesktopSettings) {
    // 开机自启是系统级注册（macOS 上是 LaunchAgent），和窗口无关，
    // 所以放在拿窗口之前——宠物窗口还没建好时也该能改这一项。
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    let _ = if settings.autostart {
        autostart.enable()
    } else {
        autostart.disable()
    };

    let Some(pet) = app.get_webview_window(PET_LABEL) else {
        return;
    };
    let _ = pet.set_always_on_top(settings.always_on_top);
    // **锁定 = 整窗鼠标穿透。** 前端那层 pointer-events 只能挡住网页自己的
    // 元素，挡不住「这个窗口在桌面上占了一块地方」——不开这个，点桌面图标
    // 还是会被透明矩形吃掉。两层都要。
    let _ = pet.set_ignore_cursor_events(settings.locked);
    let _ = pet.set_size(LogicalSize::new(settings.pet_size, settings.pet_size));
    // 两个条件都成立才显示：用户想看它，**而且**它确实已经是一只宠物。
    // 少了后半句，未登录时显示的就是那个关不掉的登录框。
    let ready = PET_READY.load(std::sync::atomic::Ordering::Relaxed);
    if settings.pet_visible && ready {
        let _ = pet.show();
    } else {
        let _ = pet.hide();
    }
    if let (Some(x), Some(y)) = (settings.pet_x, settings.pet_y) {
        let _ = pet.set_position(LogicalPosition::new(x, y));
    }
}

// ── 窗口操作（给前端和托盘共用）──────────────────────────────────────

/// 前端报告宠物窗口的状态。
///
/// `ready = true`  —— 宠物挂上了、会话有效，可以显示了。
/// `ready = false` —— 还没登录（或出了别的岔子）。这时**把窗口藏起来，
///                    并把主界面叫到前面**，让人有地方去登录。
#[tauri::command]
fn set_pet_ready(app: AppHandle, state: tauri::State<'_, SettingsState>, ready: bool) {
    PET_READY.store(ready, std::sync::atomic::Ordering::Relaxed);
    let settings = { state.0.lock().unwrap().clone() };
    apply_settings(&app, &settings);
    if !ready {
        // 没登录时宠物窗口是隐藏的，如果主窗口也收着，用户就看不到任何东西
        // 可点了——那和「应用没启动」没区别。所以这里主动把主界面推到前面。
        show_main_window(app);
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 记住宠物窗口现在在哪。拖完就存，免得下次开在别的地方。
#[tauri::command]
fn remember_pet_position(app: AppHandle, state: tauri::State<'_, SettingsState>) {
    let Some(pet) = app.get_webview_window(PET_LABEL) else {
        return;
    };
    let Ok(position) = pet.outer_position() else {
        return;
    };
    let scale = pet.scale_factor().unwrap_or(1.0);
    let logical = position.to_logical::<f64>(scale);
    let mut settings = state.0.lock().unwrap();
    settings.pet_x = Some(logical.x);
    settings.pet_y = Some(logical.y);
    settings::save(&app, &settings);
}

// ── 托盘 ────────────────────────────────────────────────────────────────

/// 托盘菜单。
///
/// **这是主窗口关掉、宠物又被锁住之后唯一的入口**，所以「显示主界面」和
/// 「解锁」必须都在这里，否则会出现一个点不动、也叫不回来的应用。
fn build_tray(app: &AppHandle, settings: &DesktopSettings) -> tauri::Result<()> {
    let show_main = MenuItem::with_id(app, "show_main", "打开主界面", true, None::<&str>)?;
    let toggle_pet = CheckMenuItem::with_id(
        app,
        "toggle_pet",
        "显示宠物",
        true,
        settings.pet_visible,
        None::<&str>,
    )?;
    let toggle_lock = CheckMenuItem::with_id(
        app,
        "toggle_lock",
        "锁定宠物（鼠标穿透）",
        true,
        settings.locked,
        None::<&str>,
    )?;
    let toggle_top = CheckMenuItem::with_id(
        app,
        "toggle_top",
        "宠物置顶",
        true,
        settings.always_on_top,
        None::<&str>,
    )?;
    let walk = MenuItem::with_id(app, "walk", "走两步", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "open_settings", "设置…", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;

    let menu = Menu::with_items(
        app,
        &[
            &show_main,
            &PredefinedMenuItem::separator(app)?,
            &toggle_pet,
            &toggle_lock,
            &toggle_top,
            &walk,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("kitty-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Kitty Love")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let state = app.state::<SettingsState>();
            let mut next = { state.0.lock().unwrap().clone() };
            match event.id().as_ref() {
                "show_main" => {
                    show_main_window(app.clone());
                    return;
                }
                "walk" => {
                    // 走动交给前端——步态、朝向、避障都在那边。
                    // 这里只发一个信号，不在 Rust 里复刻一套动画逻辑。
                    if let Some(pet) = app.get_webview_window(PET_LABEL) {
                        let _ = pet.emit("pet-command", "walk");
                    }
                    return;
                }
                "open_settings" => {
                    open_settings_window(app);
                    return;
                }
                "toggle_pet" => next.pet_visible = !next.pet_visible,
                "toggle_lock" => next.locked = !next.locked,
                "toggle_top" => next.always_on_top = !next.always_on_top,
                _ => return,
            }
            {
                let mut current = state.0.lock().unwrap();
                *current = next.clone();
            }
            apply_settings(app, &next);
            settings::save(app, &next);
            let _ = app.emit("desktop-settings-changed", &next);
        })
        .build(app)?;
    Ok(())
}

/// 设置窗口。用站点的 `/settings` 页，不另做一套 UI。
fn open_settings_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let Ok(mut url) = main.url() else { return };
    url.set_path("/settings");
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(url))
        .title("设置")
        .inner_size(520.0, 640.0)
        .resizable(true)
        .build();
}

// ── 启动 ────────────────────────────────────────────────────────────────

fn build_pet_window(app: &AppHandle, base: &url::Url, settings: &DesktopSettings) -> tauri::Result<WebviewWindow> {
    let mut url = base.clone();
    url.set_path(PET_ROUTE);
    let trusted = base.origin().ascii_serialization();

    let mut builder = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::External(url))
        .title("宠物")
        .inner_size(settings.pet_size, settings.pet_size)
        // 透明 + 无边框 + 不进任务栏 = 桌面上只看得到那只宠物本身。
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        // 切到别的桌面/全屏空间时宠物跟着走，否则「always on top」在
        // macOS 多空间下会显得时有时无。
        .visible_on_all_workspaces(true)
        .always_on_top(settings.always_on_top)
        // **一律先隐藏。** 显示与否交给 set_pet_ready——网页那边确认「宠物挂上了、
        // 会话有效」之后才亮相。这样加载中、未登录、页面报错这些中间状态，
        // 用户看到的都是「什么都没有」，而不是一个无边框置顶的怪窗口。
        .visible(false)
        .on_navigation(move |target| target.origin().ascii_serialization() == trusted);

    if let (Some(x), Some(y)) = (settings.pet_x, settings.pet_y) {
        builder = builder.position(x, y);
    }
    builder.build()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            save_device_token,
            load_device_token,
            delete_device_token,
            get_desktop_settings,
            update_desktop_settings,
            show_main_window,
            remember_pet_position,
            set_pet_ready,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            app.manage(SettingsState(std::sync::Mutex::new(settings.clone())));

            let server_url = std::env::var("KITTY_SERVER_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string());
            let base = server_url.parse::<url::Url>().map_err(|e| e.to_string())?;
            let trusted = base.origin().ascii_serialization();

            WebviewWindowBuilder::new(&handle, MAIN_LABEL, WebviewUrl::External(base.clone()))
                .title("Kitty Love")
                .inner_size(1100.0, 760.0)
                .min_inner_size(420.0, 560.0)
                .resizable(true)
                .on_navigation(move |target| target.origin().ascii_serialization() == trusted)
                .build()?;

            build_pet_window(&handle, &base, &settings)?;
            build_tray(&handle, &settings)?;
            // 位置/穿透/尺寸在窗口建好之后再落一次，builder 覆盖不到的
            // （比如 ignore_cursor_events）在这里补上。
            apply_settings(&handle, &settings);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let close_to_tray = app
                    .try_state::<SettingsState>()
                    .map(|s| s.0.lock().unwrap().close_to_tray)
                    .unwrap_or(true);
                // 关主窗口默认只是收起来。**宠物窗口不受影响**——那才是
                // 「主界面关了宠物还在」的关键；直接退出的话桌面上也就没有它了。
                if window.label() == MAIN_LABEL && close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Kitty Love desktop");
}
