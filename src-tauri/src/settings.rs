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
    /// 上次宠物窗口的位置。`None` 表示还没摆过，交给系统默认。
    pub pet_x: Option<f64>,
    pub pet_y: Option<f64>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            // **默认不锁。** 第一次打开如果宠物点不动，用户只会以为它坏了，
            // 而不会想到去托盘里找一个「锁定」开关。
            locked: false,
            always_on_top: true,
            autostart: false,
            pet_size: 220.0,
            pet_visible: true,
            close_to_tray: true,
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
