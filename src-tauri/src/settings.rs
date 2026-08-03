//! 桌面端自己的设置。
//!
//! **刻意不放进站点的 SiteConfig。** 这些是「这台电脑上的偏好」——窗口锁没锁、
//! 开机启不启动、宠物摆在哪个角——换台电脑就该是另一份。放进服务端会变成
//! 两个人两台机器共用一份，你在公司锁了宠物，她家里那只也跟着不动了。
//!
//! 存成一个 JSON 文件，放在系统的应用配置目录里（macOS 是
//! `~/Library/Application Support/love.kitty.companion/`）。

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSettings {
    /// 自己那台服务器的地址。`None` 表示还没配过，启动时先弹设置页。
    ///
    /// **必须是可改的、且改的地方在应用自己身上。** 这个包要能分发给别人
    /// 自托管，人家不可能为了换个域名重新打一次包；而写死成环境变量的话，
    /// 双击启动的 .app 根本读不到。
    pub server_url: Option<String>,
    /// 允许宠物读取的目录。**这份才是真正的闸门**——服务端那份同名字段只用于
    /// 在设置页展示。校验必须发生在本机，见 local_fs.rs 顶部。
    ///
    /// 默认空：一个目录都不给。用户显式加进来的才算数。
    pub allowed_roots: Vec<String>,
    /// 什么时候弹确认框。
    ///
    /// - `"risky"`（默认）：**只在会毁掉已有内容时问**——覆盖已有文件、
    ///   精确替换、执行命令。新建文件和追加不问，因为它们一个字节都不会毁。
    /// - `"always"`：每次都问。
    ///
    /// 默认从 `always` 改成 `risky` 是实际用下来的结论：给追加也弹框，
    /// 只会让人养成不看内容直接点「执行」的习惯——那反而把真正危险的
    /// 那一次也一起放过去了。**弹框要少而准，它才有意义。**
    pub write_approval: String,
    /// 锁定：整窗鼠标穿透，宠物变纯装饰，点不到也拖不动。
    pub locked: bool,
    /// 宠物窗口置顶。
    pub always_on_top: bool,
    /// 开机自启。
    pub autostart: bool,
    /// 宠物窗口边长（正方形）。
    pub pet_size: f64,
    /// 宠物窗口是否显示。
    pub pet_visible: bool,
    /// 关主窗口时收进托盘而不是退出。
    pub close_to_tray: bool,
    /// 自由行动：宠物跟着鼠标在桌面上走。
    ///
    /// 存下来是因为它是一个**模式**，不是一次动作——用户开了它就是希望它一直
    /// 这样，重启之后还得再翻一次菜单会很烦。菜单里有勾，所以不会出现
    /// 「它怎么自己动起来了」的困惑。
    pub roam: bool,
    /// 上次宠物窗口的位置。`None` 表示还没摆过，交给系统默认。
    pub pet_x: Option<f64>,
    pub pet_y: Option<f64>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            server_url: None,
            allowed_roots: Vec::new(),
            write_approval: "risky".into(),
            // **默认不锁。** 第一次打开如果宠物点不动，用户只会以为它坏了，
            // 而不会想到去托盘里找一个「锁定」开关。
            locked: false,
            always_on_top: true,
            autostart: false,
            pet_size: 220.0,
            pet_visible: true,
            close_to_tray: true,
            roam: false,
            pet_x: None,
            pet_y: None,
        }
    }
}

/// 进程内的当前设置。写盘是尽力而为——存不下来最多是下次启动回到默认，
/// 不该因此让应用起不来。
pub struct SettingsState(pub Mutex<DesktopSettings>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("desktop-settings.json"))
}

pub fn load(app: &AppHandle) -> DesktopSettings {
    let Some(path) = settings_path(app) else {
        return DesktopSettings::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return DesktopSettings::default();
    };
    // 解析失败就回默认值，不要报错退出：一个手改坏了的配置文件
    // 不该让人再也打不开这个应用。`serde(default)` 让缺字段也能读。
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &DesktopSettings) {
    let Some(path) = settings_path(app) else { return };
    if let Ok(text) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, text);
    }
}
