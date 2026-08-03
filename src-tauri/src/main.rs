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

/// 最近一次弹出的宠物右键菜单。
///
/// 菜单每次右键都重建（要显示当前选中项的勾），但**不能建完就扔**：
/// `popup_menu` 是非阻塞的，函数返回时菜单还挂在屏幕上，对象一旦被回收，
/// macOS 的 `NSMenu` 跟着释放，用户看到的就是「闪一下就没了」。存在这里
/// 让它活到下一次右键。
struct PetContextMenu(std::sync::Mutex<Option<Menu<tauri::Wry>>>);

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
    // 自由行动时不要把它拽回记住的位置——那个位置是上一次它停下的地方，
    // 而现在它正跟着鼠标走。不加这个判断，改任何一项设置都会让宠物瞬移一次。
    if !ROAMING.load(std::sync::atomic::Ordering::Relaxed) {
        if let (Some(x), Some(y)) = (settings.pet_x, settings.pet_y) {
            let _ = pet.set_position(LogicalPosition::new(x, y));
        }
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

// ── 自由行动 ────────────────────────────────────────────────────────────

/// 每帧最多挪多少逻辑像素，60fps 下约合每秒 780px。
const ROAM_MAX_STEP: f64 = 13.0;
/// 缓动系数。离得远走得快、快到了自己慢下来，落点不会「啪」地一停。
const ROAM_EASING: f64 = 0.14;
/// 到了就算到了。差这么几像素还继续挪只会看见它在原地抖。
const ROAM_ARRIVE_SLACK: f64 = 6.0;
/// 落点在点击处**上方**多少个身位。宠物是站着的，脚踩在你点的地方，
/// 身子在上面——直接把中心对准点击点的话，它会把你刚点的那个图标盖住。
const ROAM_FOOT_OFFSET: f64 = 0.38;

/// 自由行动开着没有。
static ROAMING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// 左键现在按着没有。
//
// **用轮询按键状态，不装全局事件钩子。** macOS 上的全局鼠标监听要「输入监控」
// 授权——那是一个能读到你在**所有应用里**每一次点击的权限，为了一只宠物去
// 要它，无论从隐私还是从「用户会不会点同意」看都不合适。
// `CGEventSourceButtonState` 只回答「此刻按着没有」，不需要任何授权。
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
}

fn left_button_pressed() -> bool {
    #[cfg(target_os = "macos")]
    {
        // kCGEventSourceStateCombinedSessionState = 0，kCGMouseButtonLeft = 0
        unsafe { CGEventSourceButtonState(0, 0) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// 点哪儿走哪儿。
///
/// ## 为什么在 Rust 里做
///
/// 桌面上的「走动」就是**移动窗口**，网页那套改 CSS 位置的做法在这里没有意义
/// ——宠物窗口只有两百像素，它在窗口里怎么挪都还在桌面同一个地方。而且点击
/// 发生在窗口**外面**，网页根本收不到。所以整件事只有这一侧能做，前端只收
/// 「在走 / 朝哪边」两个信号去播动画。
///
/// ## 为什么不是「一直跟着光标」
///
/// 试过，那个手感不对：宠物变成了挂在指针上的一块东西，你干什么它都在眼角
/// 晃。点一下才过来才像宠物——你叫它，它才动身。
///
/// ## 为什么不夹边界
///
/// 落点是你点出来的，而你点得到的地方就在屏幕上。多显示器之间它会走一条直线
/// 穿过缝隙，到得了。加夹取反而要处理「宠物和落点不在同一块屏」的情况，
/// 一不小心就是一次瞬移。
fn spawn_roam_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut announced: Option<(bool, &'static str)> = None;
        let mut was_pressed = false;
        // 要去的地方，物理像素，指的是**宠物**的中心该落在哪儿。
        let mut target: Option<(f64, f64)> = None;
        loop {
            if !ROAMING.load(std::sync::atomic::Ordering::Relaxed) {
                // 关掉时把没走完的路也丢掉，不然重新打开会先补走上一趟。
                target = None;
                was_pressed = false;
                announce_roam(&app, &mut announced, false, None);
                // 关着的时候别空转。200ms 醒一次，开关拨过来最多晚这么久生效。
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            std::thread::sleep(std::time::Duration::from_millis(16));

            if !PET_READY.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            let Some(pet) = app.get_webview_window(PET_LABEL) else {
                continue;
            };
            if !pet.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(position), Ok(size)) = (pet.outer_position(), pet.outer_size()) else {
                continue;
            };
            let scale = pet.scale_factor().unwrap_or(1.0);
            let body = {
                let state = app.state::<SettingsState>();
                let size = state.0.lock().unwrap().pet_size;
                size * scale
            };

            // 全程用物理像素。多显示器缩放不同的时候，往返换算逻辑像素
            // 会在跨屏那一刻把位置算歪。
            let width = size.width as f64;
            let height = size.height as f64;
            let left = position.x as f64;
            let top = position.y as f64;
            // 宠物在窗口里的位置。**不能直接用窗口中心**：气泡或菜单展开时
            // 窗口会被撑到 380×580，而宠物仍然贴着下沿（见 set_pet_expanded）。
            // 按「底边往上半个身位」算，收起时这个式子正好退化成窗口正中，
            // 两种状态共用一个公式。
            let pet_x = left + width / 2.0;
            let pet_y = top + height - body / 2.0;

            // 左键松开的那一下才是一次「去那儿」。按下就走的话，拖选、拖动
            // 窗口这些动作会在中途把它叫走。
            let pressed = left_button_pressed();
            let released = was_pressed && !pressed;
            was_pressed = pressed;
            if released {
                if let Ok(cursor) = app.cursor_position() {
                    let inside = cursor.x >= left
                        && cursor.x <= left + width
                        && cursor.y >= top
                        && cursor.y <= top + height;
                    // 点在宠物自己身上是在跟它互动（拖它、开菜单），不是叫它过去。
                    if !inside {
                        target = Some((cursor.x, cursor.y - body * ROAM_FOOT_OFFSET));
                    }
                }
            }

            let Some((target_x, target_y)) = target else {
                announce_roam(&app, &mut announced, false, None);
                continue;
            };
            let dx = target_x - pet_x;
            let dy = target_y - pet_y;
            let distance = dx.hypot(dy);
            if distance <= ROAM_ARRIVE_SLACK * scale {
                target = None;
                announce_roam(&app, &mut announced, false, None);
                continue;
            }

            let step = (distance * ROAM_EASING)
                .min(ROAM_MAX_STEP * scale)
                .max(1.0);
            let next_x = pet_x + dx / distance * step - width / 2.0;
            let next_y = pet_y + dy / distance * step - (height - body / 2.0);
            let _ = pet.set_position(tauri::PhysicalPosition::new(next_x, next_y));

            // 朝向只在明显有横向分量时才改，否则纯竖直移动会让它左右乱翻。
            let facing = if dx.abs() < 2.0 {
                None
            } else if dx >= 0.0 {
                Some("right")
            } else {
                Some("left")
            };
            announce_roam(&app, &mut announced, true, facing);
        }
    });
}

/// 只在状态真的变了才发事件。每帧发一次的话，前端每 16ms 就要 setState 一遍，
/// 而它需要知道的只有「开始走了」和「停下了」这两个瞬间。
///
/// `facing` 传 `None` 表示「这次没有新的朝向」——停下来和纯竖直移动都属于
/// 这一类。停下时把朝向硬掰成 right 的话，宠物会在到达的瞬间转个身。
fn announce_roam(
    app: &AppHandle,
    announced: &mut Option<(bool, &'static str)>,
    moving: bool,
    facing: Option<&'static str>,
) {
    let facing = facing
        .or_else(|| announced.map(|(_, last)| last))
        .unwrap_or("right");
    if *announced == Some((moving, facing)) {
        return;
    }
    *announced = Some((moving, facing));
    if let Some(pet) = app.get_webview_window(PET_LABEL) {
        let _ = pet.emit(
            "pet-roam",
            serde_json::json!({ "moving": moving, "facing": facing }),
        );
    }
}

/// 打开 / 关掉自由行动。
#[tauri::command]
fn set_pet_roam(app: AppHandle, state: tauri::State<'_, SettingsState>, enabled: bool) {
    // 先落原子量再动设置：跟随线程只看这一个标志，早一帧停下没有坏处，
    // 晚一帧却可能在下面存位置的时候把它又挪走了。
    ROAMING.store(enabled, std::sync::atomic::Ordering::Relaxed);

    // 关掉时把它停下的地方记住，下次启动就在那儿——跟手动拖完一样的待遇。
    let landed = (!enabled)
        .then(|| app.get_webview_window(PET_LABEL))
        .flatten()
        .and_then(|pet| {
            let scale = pet.scale_factor().unwrap_or(1.0);
            pet.outer_position()
                .ok()
                .map(|position| position.to_logical::<f64>(scale))
        });

    let next = {
        let mut current = state.0.lock().unwrap();
        current.roam = enabled;
        if let Some(landed) = landed {
            current.pet_x = Some(landed.x);
            current.pet_y = Some(landed.y);
        }
        current.clone()
    };
    settings::save(&app, &next);
    let _ = app.emit("desktop-settings-changed", &next);
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
    let (roots, approval_mode) = {
        let guard = state.0.lock().unwrap();
        (guard.allowed_roots.clone(), guard.write_approval.clone())
    };
    // 第二趟兑现时网页层会把 Rust 发出去的 id 带回来（见 change_with_consent）。
    let approval_id = arguments
        .get("approvalId")
        .and_then(|v| v.as_str())
        .map(str::to_string);
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
        "local_write" => change_with_consent(
            &app, &roots, &arg("path"), local_fs::Change::Overwrite, &arg("content"), "",
            approval_id.as_deref(), &approval_mode,
        ),
        "local_append" => change_with_consent(
            &app, &roots, &arg("path"), local_fs::Change::Append, &arg("content"), "",
            approval_id.as_deref(), &approval_mode,
        ),
        "local_edit" => change_with_consent(
            &app, &roots, &arg("path"), local_fs::Change::Edit,
            &arg("old_text"), &arg("new_text"),
            approval_id.as_deref(), &approval_mode,
        ),
        "local_run" => {
            // argv 数组，不是一个命令行字符串——见 run_command_with_consent。
            let args: Vec<String> = arguments
                .get("args")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            run_command_with_consent(&roots, &arg("program"), &args, &arg("cwd"), &approval_mode)
        }
        // **默认拒绝。** 服务端将来加了新工具而这里还没实现时，结果应该是
        // 「不支持」，而不是掉进某个分支去做一件没想清楚的事。
        other => Err(format!("这个版本的桌面端不支持「{other}」")),
    };

    audit(&app, &tool, &arg("path"), &outcome);
    outcome
}

/// 改一个文件——覆盖、追加、或按内容精确替换。
///
/// **三种改法走同一条路**：算出新内容 → 弹系统确认框 → 备份 → 写。
/// 分成三个函数的话，「备份」和「确认」这两道闸就有了三份实现，
/// 而漏掉其中一处不会有任何报错，只会在某天悄悄少备份一次。
///
/// 确认框用系统原生的：发起方就是那个网页层，让被审查的一方自己画审查界面
/// 没有意义。没有「10 分钟内允许」——改文件每次都该看一眼。
fn change_with_consent(
    app: &AppHandle,
    roots: &[String],
    path: &str,
    change: local_fs::Change,
    a: &str,
    b: &str,
    approval_id: Option<&str>,
    approval_mode: &str,
) -> Result<serde_json::Value, String> {
    // 第二趟：带着 Rust 自己发出去的 id 回来兑现。
    if let Some(id) = approval_id {
        let claimed = PENDING_APPROVALS.lock().unwrap().remove(id);
        return match claimed {
            Some(PendingAction::Write { target, content }) => {
                commit_change(app, &target, &content)
            }
            Some(PendingAction::Command { program, args, dir }) => {
                execute_command(&program, &args, &dir)
            }
            None => Err("这次授权已经过期了，请重来一次。".into()),
        };
    }

    let (target, planned) = local_fs::plan_change(roots, path, change, a, b)?;

    // 会毁掉已有内容的才问。新建和追加不问——它们一个字节都不会毁，
    // 给它们弹确认只会让人养成不看内容直接点同意的习惯，
    // 那反而把真正危险的那一次也一起放过去了。
    let risky = planned.destructive;
    if approval_mode == "never" || (approval_mode == "risky" && !risky) {
        return commit_change(app, &target, &planned.content);
    }

    // 需要人点头。**把算好的内容存在 Rust 这边**，只把 id 交出去——
    // 网页层拿不到也改不了将要写下去的内容，它能做的只是把 id 递回来。
    // 这是「审批界面放在网页里」能成立的关键：被审查的是模型，而模型
    // 既进不了这个 map，也伪造不出这个 id。
    let id = stash(PendingAction::Write {
        target: target.clone(),
        content: planned.content.clone(),
    });

    Ok(serde_json::json!({
        "needsApproval": {
            "id": id,
            "title": planned.title,
            "path": target.to_string_lossy(),
            "preview": planned.preview,
            "existed": planned.existed,
        }
    }))
}

/// 真正落盘：备份 → 写。
fn commit_change(
    app: &AppHandle,
    target: &std::path::Path,
    content: &str,
) -> Result<serde_json::Value, String> {
    let backup = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| local_fs::backup_before_write(&dir, target));
    std::fs::write(target, content).map_err(|e| format!("写不进去：{e}"))?;
    Ok(serde_json::json!({
        "path": target.to_string_lossy(),
        "bytes": content.len(),
        "backedUpTo": backup.map(|p| p.to_string_lossy().into_owned()),
    }))
}

/// 一件等着人点头的事。
pub enum PendingAction {
    Write { target: std::path::PathBuf, content: String },
    Command { program: String, args: Vec<String>, dir: std::path::PathBuf },
}

/// 等着人点头的动作。**内容存在这里，不经过网页层。**
///
/// 网页层只拿得到一个 id。它改不了将要写下去的内容，也改不了将要执行的命令
/// ——这是「审批界面放在气泡里」能成立的关键：被审查的是模型，
/// 而模型既进不了这个 map，也伪造不出这里的 id。
static PENDING_APPROVALS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, PendingAction>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn stash(action: PendingAction) -> String {
    let id = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    PENDING_APPROVALS.lock().unwrap().insert(id.clone(), action);
    id
}

/// 用户在气泡里点了「不用了」。把暂存的内容丢掉。
#[tauri::command]
fn discard_pending_change(id: String) {
    PENDING_APPROVALS.lock().unwrap().remove(&id);
}

/// 在授权目录里跑一条命令。**这是整套本地能力里最危险的一个。**
///
/// ## 不经 shell
///
/// 参数是一个 argv 数组，直接交给 `Command`，**不拼成字符串丢给 `sh -c`**。
/// 这一条是这里最重要的设计：走 shell 的话，`;`、`&&`、`|`、`$(...)`、反引号
/// 全都会被解释，于是「参数」和「命令」的边界就没了——模型只要在某个文件名
/// 参数里带上 `; rm -rf ~`，闸门就形同虚设。argv 数组里那些字符只是普通字符。
///
/// ## 不做「安全命令白名单」
///
/// 枚举安全命令是走不通的：`git` 看着无害，
/// `git config --global core.pager 'sh -c ...'` 就不是。真正的安全来自
/// 工作目录受限 + 每次人工确认 + 不经 shell 这三条。
fn run_command_with_consent(
    roots: &[String],
    program: &str,
    args: &[String],
    cwd: &str,
    approval_mode: &str,
) -> Result<serde_json::Value, String> {
    let (dir, display) = local_fs::prepare_command(roots, program, args, cwd)?;

    // 命令**永远**要人点头，`risky` 模式也不例外——它的破坏力和「改一个文件」
    // 不是一个量级，而且没有备份可以回滚。只有显式设成 never 才跳过。
    if approval_mode == "never" {
        return execute_command(program, args, &dir);
    }

    let id = stash(PendingAction::Command {
        program: program.to_string(),
        args: args.to_vec(),
        dir: dir.clone(),
    });
    Ok(serde_json::json!({
        "needsApproval": {
            "id": id,
            "title": "要执行这条命令吗？",
            "path": dir.to_string_lossy(),
            "preview": format!(
                "命令：\n{display}\n\n不经过 shell，所以 ; && | $() 只是普通字符。\n\
                 最多跑 {} 秒。",
                local_fs::COMMAND_TIMEOUT_SECS
            ),
            "existed": true,
        }
    }))
}

/// 真正把命令跑起来。
fn execute_command(
    program: &str,
    args: &[String],
    dir: &std::path::Path,
) -> Result<serde_json::Value, String> {
    use std::process::{Command, Stdio};

    let mut child = Command::new(program)
        .args(args)
        .current_dir(dir)
        // 不继承标准输入：需要交互的命令（比如等密码的 sudo）会直接读到 EOF
        // 退出，而不是挂在那儿等一个永远不会来的输入。
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("跑不起来：{e}（这个命令存在吗？）"))?;

    // 超时就杀掉。没有这一条的话，一个卡住的子进程会让整轮对话干等到派发超时，
    // 而那个进程还在后台继续跑。
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(local_fs::COMMAND_TIMEOUT_SECS);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Ok(None) => {
                let _ = child.kill();
                break None;
            }
            Err(e) => return Err(format!("等不到结果：{e}")),
        }
    };

    let output = child.wait_with_output().map_err(|e| format!("读不到输出：{e}"))?;
    let clip = |bytes: &[u8]| {
        let text = String::from_utf8_lossy(bytes);
        if text.len() > local_fs::MAX_OUTPUT_BYTES {
            format!("{}\n…（输出太长，已截断）", &text[..local_fs::MAX_OUTPUT_BYTES])
        } else {
            text.into_owned()
        }
    };

    Ok(serde_json::json!({
        "cwd": dir.to_string_lossy(),
        "timedOut": status.is_none(),
        "exitCode": status.and_then(|s| s.code()),
        "stdout": clip(&output.stdout),
        "stderr": clip(&output.stderr),
    }))
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
    // 自由行动时窗口一直在动，前端的 onMoved 会不停触发——照做就是每秒往
    // 配置文件里写好几次。跟随停下（或被关掉）时 `set_pet_roam` 会补存一次，
    // 该记住的位置一个都不会丢。
    if ROAMING.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
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

/// 右键菜单打开时，宠物当前是什么状态。
///
/// **这些值只有前端知道。** 造型和主动性存在站点那边、大小存在浏览器
/// localStorage 里，Rust 从来没有过一份副本。与其在 Rust 里再养一份影子状态
/// （然后眼看着它和真值慢慢对不上），不如每次右键让前端把当前值报上来。
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetMenuState {
    appearance: Option<String>,
    size: Option<String>,
    initiative: Option<String>,
    roam: bool,
}

/// 一组互斥选项，选中的那个打勾。
///
/// macOS 的原生菜单没有 radio 型菜单项，约定俗成就是用 CheckMenuItem——
/// Finder 的「排序方式」、系统设置里的各种模式选择都是这么做的。
fn checked_group(
    app: &AppHandle,
    title: &str,
    prefix: &str,
    options: &[(&str, &str)],
    current: Option<&str>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::new(app, title);
    let items = options
        .iter()
        .map(|(id, label)| {
            CheckMenuItem::with_id(
                app,
                format!("{prefix}{id}"),
                label,
                true,
                current == Some(id),
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    for item in &items {
        builder = builder.item(item);
    }
    builder.build()
}

/// 在鼠标当前位置弹出真正的系统右键菜单。
///
/// 透明 WebView 里的 HTML 浮层永远受窗口矩形裁剪；菜单 DOM 即使已经渲染，
/// 超出两百多像素的宠物窗口后仍然完全看不见。这里让 Tauri 交给系统菜单层绘制，
/// 选择结果再发回前端，动作和面板仍只保留一套 React 实现。
///
/// **每次右键重新构建，不复用同一份。** 菜单要显示「现在选的是哪个」，而那些
/// 状态随时在变；构建一次存起来的话，勾会永远停在应用启动那一刻的样子。
/// 重建一份十几项的菜单是微秒级的事，不值得为此留一个会说谎的缓存。
fn build_pet_context_menu(
    app: &AppHandle,
    state: &PetMenuState,
) -> tauri::Result<Menu<tauri::Wry>> {
    // 动作是**一次性命令**，不是状态，所以不打勾——给「走两步」画个勾，
    // 反而会让人以为宠物进入了某种「走路模式」。
    let actions = SubmenuBuilder::new(app, "动作")
        .text("petctx:action:calm", "安静待着")
        .text("petctx:action:walk", "走两步")
        .text("petctx:action:sleep", "睡一会儿")
        .text("petctx:action:play", "玩耍")
        .text("petctx:action:feed", "吃东西")
        .text("petctx:action:cheer", "开心一下")
        .build()?;
    let appearance = checked_group(
        app,
        "外观",
        "petctx:appearance:",
        &[
            ("kitty", "Kitty"),
            ("momo", "Momo"),
            ("hello-kitty", "Hello Kitty"),
            ("snoopy", "Snoopy"),
            ("shiba", "柴犬"),
            ("bichon", "比熊"),
            ("shiba-q", "柴犬（插画）"),
            ("bichon-q", "比熊（插画）"),
        ],
        state.appearance.as_deref(),
    )?;
    let size = checked_group(
        app,
        "大小",
        "petctx:size:",
        &[("small", "小"), ("medium", "中"), ("large", "大")],
        state.size.as_deref(),
    )?;
    let initiative = checked_group(
        app,
        "主动性",
        "petctx:initiative:",
        &[
            ("normal", "偶尔主动"),
            ("quiet", "安静模式"),
            ("off", "完全安静"),
        ],
        state.initiative.as_deref(),
    )?;
    // 自由行动放在最外层而不是塞进「动作」：它是个开关，开着的时候宠物
    // 的整体行为都变了，值得在不展开任何子菜单时就能一眼看到勾。
    let roam = CheckMenuItem::with_id(
        app,
        "petctx:roam",
        "自由行动（点哪儿走哪儿）",
        true,
        state.roam,
        None::<&str>,
    )?;

    MenuBuilder::new(app)
        .text("petctx:chat", "说句话…")
        .text("petctx:today", "今天")
        .text("petctx:main", "打开主界面")
        .separator()
        .item(&actions)
        .item(&appearance)
        .item(&size)
        .item(&initiative)
        .item(&roam)
        .separator()
        .text("petctx:rename", "改名…")
        .text("petctx:settings", "桌面设置…")
        .build()
}

#[tauri::command]
fn show_pet_context_menu(
    app: AppHandle,
    menu: tauri::State<'_, PetContextMenu>,
    state: Option<PetMenuState>,
) -> Result<(), String> {
    let Some(pet) = app.get_webview_window(PET_LABEL) else {
        return Err("宠物窗口还没有就绪".into());
    };
    let built = build_pet_context_menu(&app, &state.unwrap_or_default())
        .map_err(|error| error.to_string())?;
    // **先存进 State 再弹。** `popup_menu` 是非阻塞的：菜单还挂在屏幕上，
    // 这个函数就已经返回了。菜单对象在这里被回收的话，macOS 那边的 NSMenu
    // 会跟着释放，用户看到的是「右键了一下，闪了一下就没了」。
    let mut guard = menu.0.lock().unwrap();
    let current = guard.insert(built);
    pet.popup_menu(current).map_err(|error| error.to_string())
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
            discard_pending_change,
            search_local_files,
            read_local_attachment,
            show_pet_context_menu,
            set_pet_roam,
            get_server_url,
            save_server_url,
            close_setup_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            app.manage(SettingsState(std::sync::Mutex::new(settings.clone())));
            // 空的。菜单在第一次右键时才建，那时才知道宠物现在是什么造型、
            // 什么大小、什么主动性——启动时建一份的话，勾会永远停在启动那一刻。
            app.manage(PetContextMenu(std::sync::Mutex::new(None)));

            ROAMING.store(settings.roam, std::sync::atomic::Ordering::Relaxed);
            spawn_roam_loop(handle.clone());

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
