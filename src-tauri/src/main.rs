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

mod local_fs;
mod settings;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

use settings::{DesktopSettings, SettingsState};
use tauri::{
    menu::{
        CheckMenuItem, IsMenuItem, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu,
        SubmenuBuilder,
    },
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
const SETUP_LABEL: &str = "setup";
/// 必须和前端 `lib/desktopPet.ts` 里的 DESKTOP_PET_ROUTE 一致。
const PET_ROUTE: &str = "/desktop-pet";

/// 原生菜单必须和 App 同寿命。临时在命令里创建的 macOS `NSMenu` 在弹出调用
/// 返回后就会被释放；持有成应用状态也避免每次右键重复注册同一批菜单项。
struct PetContextMenu(Menu<tauri::Wry>);

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
    // **运行时再关一次阴影。** builder 上的 `.shadow(false)` 在 macOS 的透明窗
    // 上不总是生效——已知问题（tauri#5494 / #14394）：透明窗会留下一圈黑边，
    // 焦点切换时更明显，看起来就是宠物背后压着一个深色方块。
    let _ = pet.set_shadow(false);
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

/// 菜单/对话面板打开时把宠物窗口撑大，关上再收回去。
///
/// 宠物窗口只有两百来像素——**菜单在里面根本放不下**，会被窗口边界裁掉，
/// 表现是「右键了但什么都没出现」。
///
/// 换成在 Rust 里再写一套原生菜单也能解决，但那样动作、外观、改名这些就有了
/// 两份实现，改一处得记得改两处。撑大窗口是更省的做法：菜单还是网页那一套。
#[tauri::command]
fn set_pet_expanded(app: AppHandle, state: tauri::State<'_, SettingsState>, expanded: bool) {
    let Some(pet) = app.get_webview_window(PET_LABEL) else {
        return;
    };
    let base = { state.0.lock().unwrap().pet_size };
    let (w, h) = if expanded {
        // 四行菜单、对话框和长气泡都需要宠物上方有完整空间。
        (base.max(380.0), base.max(580.0))
    } else {
        (base, base)
    };

    // set_size 默认钉住窗口左上角，结果宠物（位于窗口中央）会在右键时跳半个
    // 扩容量。同步补偿位置，把原来的 base × base 宠物区域锚在屏幕原处。
    let next_position = pet
        .outer_position()
        .ok()
        .zip(pet.outer_size().ok())
        .map(|(position, size)| {
            let scale = pet.scale_factor().unwrap_or(1.0);
            let position = position.to_logical::<f64>(scale);
            let size = size.to_logical::<f64>(scale);
            LogicalPosition::new(
                position.x + (size.width - w) / 2.0,
                position.y + size.height - h,
            )
        });
    let _ = pet.set_size(LogicalSize::new(w, h));
    let _ = pet.set_shadow(false);
    if let Some(position) = next_position {
        let _ = pet.set_position(position);
    }
}

// ── 本地文件（二期）──────────────────────────────────────────────────

/// 执行一次本地文件调用。**闸门在这儿，不在服务端。**
///
/// 云端那个 agent 会读联网搜索结果、对方的消息——全是不可信输入。把「能不能读
/// 这个路径」交给它判断，等于把闸门交给一个可能被提示注入影响的系统。
/// 所以白名单从**本机配置**里取，校验也在本机做（见 local_fs.rs）。
///
/// 返回值刻意做成 `Result<Value, String>`：拒绝的理由要能原样交给模型，
/// 让它知道该去调 local_roots，而不是换个写法反复重试。
#[tauri::command]
fn run_local_tool(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    tool: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let roots = { state.0.lock().unwrap().allowed_roots.clone() };
    let arg = |key: &str| -> String {
        arguments
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };

    let outcome = match tool.as_str() {
        "local_roots" => Ok(serde_json::json!({ "roots": roots })),
        "local_list" => local_fs::list(&roots, &arg("path"))
            .map(|items| serde_json::json!({ "entries": items })),
        "local_read" => {
            local_fs::read(&roots, &arg("path")).map(|text| serde_json::json!({ "content": text }))
        }
        "local_search" => local_fs::search(&roots, &arg("path"), &arg("pattern"))
            .map(|items| serde_json::json!({ "entries": items })),
        "local_info" => {
            local_fs::info(&roots, &arg("path")).map(|item| serde_json::json!({ "info": item }))
        }
        // **默认拒绝。** 服务端将来加了新工具而这里还没实现时，结果应该是
        // 「不支持」，而不是掉进某个分支去做一件没想清楚的事。
        other => Err(format!("这个版本的桌面端不支持「{other}」")),
    };

    audit(&app, &tool, &arg("path"), &outcome);
    outcome
}

/// 聊天框里打 `@` 时的文件候选。
///
/// **直接在本机查，不绕云端。** 这是打字时的即时补全，走一趟服务器再回来
/// 会明显发涩；而且候选列表里全是文件路径，没有任何理由让它经过网络。
#[tauri::command]
fn search_local_files(
    state: tauri::State<'_, SettingsState>,
    query: String,
) -> Vec<local_fs::EntryInfo> {
    let roots = { state.0.lock().unwrap().allowed_roots.clone() };
    local_fs::search_all(&roots, &query)
}

/// 把选中的文件读出来，交给网页层走现有的附件上传管线。
///
/// **返回 base64 而不是让网页层自己去读。** 网页层根本没有文件系统访问权
/// ——这正是我们要的：能读什么由这一层的白名单决定，网页层只是个搬运工。
#[tauri::command]
fn read_local_attachment(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    path: String,
) -> Result<serde_json::Value, String> {
    let roots = { state.0.lock().unwrap().allowed_roots.clone() };
    let outcome = local_fs::read_for_attach(&roots, &path);
    // 附件也要进审计：这是文件内容真正离开这台电脑的一刻，
    // 比只读一眼更值得记。
    audit(
        &app,
        "attach",
        &path,
        &outcome.as_ref().map(|_| serde_json::Value::Null).map_err(|e| e.clone()),
    );
    let (name, bytes) = outcome?;
    Ok(serde_json::json!({
        "name": name,
        "base64": BASE64.encode(&bytes),
    }))
}

/// 把每一次本地调用记在本机。
///
/// **审计必须在本地。** 出了事之后想知道「它到底读过什么」，不能只依赖服务端
/// 日志——那份在云上，而这件事发生在你的电脑上。
fn audit(app: &AppHandle, tool: &str, path: &str, outcome: &Result<serde_json::Value, String>) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let verdict = match outcome {
        Ok(_) => "允许".to_string(),
        Err(reason) => format!("拒绝：{reason}"),
    };
    let now = local_fs::format_epoch_public(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    );
    let line = format!("{now}\t{tool}\t{path}\t{verdict}\n");
    // 追加写。写不进去不该连累宠物读文件，但也不能悄悄吞掉——
    // 一个「有审计」却其实没在记的系统比没有审计更糟。
    if let Err(error) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("local-access.log"))
        .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()))
    {
        eprintln!("审计日志写不进去：{error}");
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

/// 只允许拖动独立宠物窗。前端不拿通用窗口拖动权限，避免远程页面把主窗或
/// 设置窗也变成可随意拖动的目标。
#[tauri::command]
fn start_pet_dragging(app: AppHandle) -> Result<(), String> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window is not available".to_string())?;
    pet.start_dragging().map_err(|error| error.to_string())
}

/// 在鼠标当前位置弹出真正的系统右键菜单。
///
/// 透明 WebView 里的 HTML 浮层永远受窗口矩形裁剪；菜单 DOM 即使已经渲染，
/// 超出两百多像素的宠物窗口后仍然完全看不见。这里让 Tauri 交给系统菜单层绘制，
/// 选择结果再发回前端，动作和面板仍只保留一套 React 实现。
fn build_pet_context_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let actions = SubmenuBuilder::new(app, "动作")
        .text("petctx:action:calm", "安静待着")
        .text("petctx:action:walk", "走两步")
        .text("petctx:action:sleep", "睡一会儿")
        .text("petctx:action:play", "玩耍")
        .text("petctx:action:feed", "吃东西")
        .text("petctx:action:cheer", "开心一下")
        .build()?;
    let appearance = SubmenuBuilder::new(app, "外观")
        .text("petctx:appearance:kitty", "Kitty")
        .text("petctx:appearance:momo", "Momo")
        .text("petctx:appearance:hello-kitty", "Hello Kitty")
        .text("petctx:appearance:snoopy", "Snoopy")
        .text("petctx:appearance:shiba", "柴犬")
        .text("petctx:appearance:bichon", "比熊")
        .text("petctx:appearance:shiba-q", "柴犬（插画）")
        .text("petctx:appearance:bichon-q", "比熊（插画）")
        .build()?;
    let size = SubmenuBuilder::new(app, "大小")
        .text("petctx:size:small", "小")
        .text("petctx:size:medium", "中")
        .text("petctx:size:large", "大")
        .build()?;
    let initiative = SubmenuBuilder::new(app, "主动性")
        .text("petctx:initiative:normal", "偶尔主动")
        .text("petctx:initiative:quiet", "安静模式")
        .text("petctx:initiative:off", "完全安静")
        .build()?;

    MenuBuilder::new(app)
        .text("petctx:chat", "说句话…")
        .text("petctx:today", "今天")
        .text("petctx:main", "打开主界面")
        .separator()
        .item(&actions)
        .item(&appearance)
        .item(&size)
        .item(&initiative)
        .separator()
        .text("petctx:rename", "改名…")
        .text("petctx:settings", "桌面设置…")
        .build()
}

#[tauri::command]
fn show_pet_context_menu(
    app: AppHandle,
    menu: tauri::State<'_, PetContextMenu>,
) -> Result<(), String> {
    let Some(pet) = app.get_webview_window(PET_LABEL) else {
        return Err("宠物窗口还没有就绪".into());
    };
    pet.popup_menu(&menu.0).map_err(|error| error.to_string())
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
    let setup_item = MenuItem::with_id(app, "open_setup", "连接设置…", true, None::<&str>)?;
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
            &setup_item,
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
                    open_site_settings_window(app);
                    return;
                }
                "open_setup" => {
                    open_setup_window(app);
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

/// 连接设置（服务器地址）。**这一页是打包进来的本地页面。**
///
/// 不能用服务器上的 `/settings`——那正是「地址填错了」时打不开的东西：
/// 连不上所以打不开设置，打不开设置所以改不了地址。同一类自锁，
/// 前面已经在宠物窗口上栽过一次，不能再栽第二次。
fn open_setup_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(SETUP_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        SETUP_LABEL,
        WebviewUrl::App("desktop/setup.html".into()),
    )
    .title("连接设置")
    .inner_size(460.0, 480.0)
    .resizable(false)
    .build();
}

/// 站点自己的设置页（passkey、桌面偏好）。连上之后才有意义。
fn open_site_settings_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        // 还没连上服务器，能给的只有连接设置。
        open_setup_window(app);
        return;
    };
    let Ok(mut url) = main.url() else { return };
    url.set_path("/settings");
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(url))
        .title("设置")
        .inner_size(520.0, 660.0)
        .resizable(true)
        .build();
}

#[tauri::command]
fn get_server_url(state: tauri::State<'_, SettingsState>) -> Option<String> {
    state.0.lock().unwrap().server_url.clone()
}

#[tauri::command]
fn close_setup_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window(SETUP_LABEL) {
        let _ = window.close();
    }
}

/// 存服务器地址，然后把主窗口和宠物窗口指过去。
#[tauri::command]
fn save_server_url(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    url: String,
) -> Result<(), String> {
    let trimmed = url.trim().trim_end_matches('/').to_string();
    let parsed = trimmed
        .parse::<url::Url>()
        .map_err(|_| "地址格式不对，要带 https:// 或 http://".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 http:// 和 https://".into());
    }
    if parsed.host_str().is_none() {
        return Err("这个地址里没有主机名".into());
    }

    let next = {
        let mut current = state.0.lock().unwrap();
        current.server_url = Some(trimmed);
        current.clone()
    };
    settings::save(&app, &next);

    open_app_windows(&app, &parsed, &next).map_err(|e| e.to_string())?;
    close_setup_window(app);
    Ok(())
}

// ── 顶部菜单 ────────────────────────────────────────────────────────────

/// macOS 顶部菜单栏 / Windows 窗口菜单。
///
/// 托盘之外再给一条路：托盘图标在某些 macOS 版本上会被「菜单栏图标太多」
/// 挤掉，而顶部菜单是跟着应用走的，不会消失。**连接设置必须在这里**——
/// 它是服务器连不上时唯一还能用的入口。
fn build_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let setup = MenuItem::with_id(app, "menu_setup", "连接设置…", true, Some("CmdOrCtrl+,"))?;
    let site_settings =
        MenuItem::with_id(app, "menu_site_settings", "账号与桌面设置…", true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "menu_show_main", "主界面", true, None::<&str>)?;

    // 混着 MenuItem 和 PredefinedMenuItem 时必须显式标成 `&dyn IsMenuItem`，
    // 否则类型推断会拿第一个元素的具体类型去要求后面所有元素。
    let app_menu = Submenu::with_items(
        app,
        "Kitty Love",
        true,
        &[
            &setup as &dyn IsMenuItem<_>,
            &site_settings,
            &PredefinedMenuItem::separator(app)?,
            &show_main,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, Some("退出"))?,
        ],
    )?;

    // 编辑菜单不是摆设：没有它，macOS 的输入框连 Cmd+V 都用不了
    // ——登录时粘贴不了密码，填服务器地址也只能一个字一个字敲。
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "menu_setup" => open_setup_window(app),
        "menu_site_settings" => open_site_settings_window(app),
        "menu_show_main" => show_main_window(app.clone()),
        "petctx:main" => show_main_window(app.clone()),
        "petctx:settings" => open_site_settings_window(app),
        id => {
            if let Some(command) = id.strip_prefix("petctx:") {
                if let Some(pet) = app.get_webview_window(PET_LABEL) {
                    let _ = pet.emit("pet-context-command", command);
                }
            }
        }
    });
    Ok(())
}

// ── 启动 ────────────────────────────────────────────────────────────────

/// 把主窗口和宠物窗口开到指定服务器上。已经存在就直接导航过去，
/// 这样「改地址」不需要重启应用。
fn open_app_windows(
    app: &AppHandle,
    base: &url::Url,
    settings: &DesktopSettings,
) -> tauri::Result<()> {
    let trusted = base.origin().ascii_serialization();

    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.navigate(base.clone());
        let _ = main.show();
        let _ = main.set_focus();
    } else {
        let guard = trusted.clone();
        WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::External(base.clone()))
            .title("Kitty Love")
            .inner_size(1100.0, 760.0)
            .min_inner_size(420.0, 560.0)
            .resizable(true)
            .on_navigation(move |target| target.origin().ascii_serialization() == guard)
            .build()?;
    }

    let mut pet_url = base.clone();
    pet_url.set_path(PET_ROUTE);
    if let Some(pet) = app.get_webview_window(PET_LABEL) {
        // 换服务器时宠物要重新验一次会话，先藏起来等它自己报到。
        PET_READY.store(false, std::sync::atomic::Ordering::Relaxed);
        let _ = pet.hide();
        let _ = pet.navigate(pet_url);
    } else {
        build_pet_window(app, base, settings)?;
    }
    Ok(())
}

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
        // 官方单实例插件必须最先注册。再次双击 App 时只唤起已有主窗口，
        // 不会再创建第二个宠物窗口，看起来像拖动留下残影。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app.clone());
        }))
        .plugin(tauri_plugin_dialog::init())
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
            start_pet_dragging,
            set_pet_ready,
            set_pet_expanded,
            run_local_tool,
            search_local_files,
            read_local_attachment,
            show_pet_context_menu,
            get_server_url,
            save_server_url,
            close_setup_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            app.manage(SettingsState(std::sync::Mutex::new(settings.clone())));
            app.manage(PetContextMenu(build_pet_context_menu(&handle)?));

            build_tray(&handle, &settings)?;
            build_app_menu(&handle)?;

            // 服务器地址的来源，优先级从高到低：
            //   1. KITTY_SERVER_URL 环境变量（开发时方便，`cargo run` 直接指过去）
            //   2. 存下来的设置（正常路径，用户自己在设置页填的）
            //   3. 都没有 → 弹连接设置页
            //
            // **没有硬编码的默认值。** 以前默认 localhost:3000，对分发出去的包
            // 来说毫无意义——别人自托管的地址不可能是我的开发机，而双击启动的
            // .app 又读不到环境变量，等于永远连不上还不知道去哪儿改。
            let configured = std::env::var("KITTY_SERVER_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| settings.server_url.clone());

            match configured.and_then(|value| value.parse::<url::Url>().ok()) {
                Some(base) => {
                    open_app_windows(&handle, &base, &settings)?;
                    // 穿透/尺寸/位置在窗口建好之后再落一次，
                    // builder 覆盖不到的（比如 ignore_cursor_events）在这里补上。
                    apply_settings(&handle, &settings);
                }
                None => open_setup_window(&handle),
            }
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
