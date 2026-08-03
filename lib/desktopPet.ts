'use client';

import { invoke } from '@tauri-apps/api/core';

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
    /** 自由行动：宠物跟着鼠标在桌面上走。 */
    roam: boolean;
    /** 上次宠物窗口的位置，还没摆过时是 null。 */
    petX: number | null;
    petY: number | null;
    /**
     * 允许宠物读取的目录。**默认空：一个都不给。**
     *
     * 这份是显示用的副本，真正的闸门在 Rust 侧（src-tauri/src/local_fs.rs）
     * 按同一份配置校验。服务端也存了一份同名字段，那份**只**用于在设置页展示，
     * 不参与任何判断——把闸门放在可能被提示注入影响的一侧就不叫闸门了。
     */
    allowedRoots: string[];
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
    // **默认不锁**：第一次打开如果宠物点不动，用户会以为它坏了。
    locked: false,
    alwaysOnTop: true,
    autostart: false,
    petSize: 220,
    petVisible: true,
    closeToTray: true,
    roam: false,
    petX: null,
    petY: null,
    allowedRoots: [],
};

/**
 * 把主窗口叫到前面来。
 *
 * 宠物窗口是无边框的，没有系统按钮，用户从那边回主界面只有这一条路
 * （另一条是托盘菜单）。不在 Tauri 里就是空操作。
 */
export async function openMainWindow(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    await invoke('show_main_window');
}

/**
 * 右键菜单打开的那一刻，宠物是什么状态。
 *
 * 造型和主动性在站点那边、大小在 localStorage 里，Rust 一份都没有。菜单要
 * 打勾就得有人告诉它，而唯一知道真值的就是这里。
 */
export interface PetMenuState {
    appearance?: string;
    size?: string;
    initiative?: string;
    roam: boolean;
}

/** 在桌宠当前位置弹出操作系统原生右键菜单。 */
export async function openPetContextMenu(state: PetMenuState): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    await invoke('show_pet_context_menu', { state });
}

/**
 * 自由行动：宠物跟着鼠标在桌面上走。
 *
 * 真正的跟随在 Rust 那边（src-tauri/src/main.rs）——桌面上的「走动」是移动
 * 窗口，网页改 CSS 位置在这里没有意义，宠物窗口只有两百像素，它在里面怎么挪
 * 都还在原地。这边只负责拨开关，以及收 Rust 发回来的「在走 / 朝哪边」。
 */
export async function setPetRoam(enabled: boolean): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    await invoke('set_pet_roam', { enabled });
}

/**
 * 左键按住宠物时，让 Rust 对唯一的 `pet` 窗口发起系统拖动。
 *
 * 不把通用 `core:window:startDragging` 能力直接暴露给远程 WebView：这里只允许
 * 应用自己的窄命令，而且 Rust 侧固定目标窗口，主界面和设置窗都拖不到。
 */
export async function startPetWindowDragging(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    await invoke('start_pet_dragging');
}

/**
 * 菜单/面板要展开时，先跟 Rust 要更大的窗口；关上再收回去。
 *
 * 宠物窗口只有两百来像素，菜单在里面装不下会被窗口边界裁掉——表现是
 * 「右键了但什么都没出现」。不在 Tauri 里就是空操作。
 */
export async function requestPetWindowRoom(expanded: boolean): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    await invoke('set_pet_expanded', { expanded }).catch(() => {});
}

/** 宠物窗口可选的几档大小。和 Rust 侧的窗口尺寸一一对应。 */
export const PET_WINDOW_SIZES = [
    { id: 'small', label: '小', px: 160 },
    { id: 'medium', label: '中', px: 220 },
    { id: 'large', label: '大', px: 300 },
] as const;
