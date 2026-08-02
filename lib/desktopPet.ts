'use client';

/**
 * 桌面宠物窗口的共享约定。
 *
 * ## 为什么宠物要单独一个窗口
 *
 * 以前的「桌面模式」是把**同一个窗口**里的页面藏掉，只留宠物。那样宠物和主
 * 界面是一体的：想看照片就得让宠物窗口变回网页，宠物就从桌面上消失了。
 *
 * 现在拆成两个窗口：`main` 是站点，`pet` 只有宠物。主界面关掉、最小化、藏进
 * 托盘，宠物都还在桌面上待着——这才是「桌宠」该有的样子。
 */

/** 宠物窗口加载的路由。Rust 侧按这个路径开窗，两边必须一致。 */
export const DESKTOP_PET_ROUTE = '/desktop-pet';

/** Rust 侧给宠物窗口起的 label，`WebviewWindow.getByLabel` 用得到。 */
export const PET_WINDOW_LABEL = 'pet';

/** 主窗口的 label。 */
export const MAIN_WINDOW_LABEL = 'main';

/**
 * 桌面偏好。**字段必须和 `src-tauri/src/settings.rs` 的 DesktopSettings 一一对应**
 * ——那边是 `serde(rename_all = "camelCase")`，两边对不上不会报错，只会静默丢字段。
 */
export interface DesktopSettings {
    /** 锁定：完全鼠标穿透，宠物变成纯装饰，点不到也拖不动。 */
    locked: boolean;
    /** 宠物窗口是否置顶。 */
    alwaysOnTop: boolean;
    /** 开机自启。 */
    autostart: boolean;
    /** 宠物窗口边长（正方形，像素）。 */
    petSize: number;
    /** 宠物窗口是否显示。 */
    petVisible: boolean;
    /** 关掉主窗口时是收进托盘还是退出整个应用。 */
    closeToTray: boolean;
    /** 上次宠物窗口的位置，还没摆过时是 null。 */
    petX: number | null;
    petY: number | null;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
    // **默认不锁**：第一次打开如果宠物点不动，用户会以为它坏了。
    locked: false,
    alwaysOnTop: true,
    autostart: false,
    petSize: 220,
    petVisible: true,
    closeToTray: true,
    petX: null,
    petY: null,
};

/**
 * 把主窗口叫到前面来。
 *
 * 宠物窗口是无边框的，没有系统按钮，用户从那边回主界面只有这一条路
 * （另一条是托盘菜单）。不在 Tauri 里就是空操作。
 */
export async function openMainWindow(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_main_window');
}

/**
 * 菜单/面板要展开时，先跟 Rust 要更大的窗口；关上再收回去。
 *
 * 宠物窗口只有两百来像素，菜单在里面装不下会被窗口边界裁掉——表现是
 * 「右键了但什么都没出现」。不在 Tauri 里就是空操作。
 */
export async function requestPetWindowRoom(expanded: boolean): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI__' in window)) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_pet_expanded', { expanded }).catch(() => {});
}

/** 宠物窗口可选的几档大小。和 Rust 侧的窗口尺寸一一对应。 */
export const PET_WINDOW_SIZES = [
    { id: 'small', label: '小', px: 160 },
    { id: 'medium', label: '中', px: 220 },
    { id: 'large', label: '大', px: 300 },
] as const;
