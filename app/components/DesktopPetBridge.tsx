'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isTauriDesktop } from '@/lib/desktop';
import { DESKTOP_PET_ROUTE, type DesktopSettings } from '@/lib/desktopPet';

/**
 * 宠物窗口和 Rust 侧之间的那几根线。**只在宠物窗口里生效。**
 *
 * 做三件事：
 *
 * 1. **把锁定状态同步到 DOM。** Rust 那边开的是整窗鼠标穿透
 *    （`set_ignore_cursor_events`），但网页自己并不知道被锁了——不同步的话
 *    宠物还会跟着鼠标做悬停反应，看着像"活的却点不动"，很怪。
 * 2. **接托盘发来的命令**（目前只有「走两步」）。动作逻辑留在前端，
 *    Rust 只发信号，不在两边各写一套步态。
 * 3. **记住窗口被拖到哪了。** 无边框窗口靠 `data-tauri-drag-region` 拖动，
 *    松手后要存一次位置，否则下次启动它又回到原点。
 */
export default function DesktopPetBridge() {
    const pathname = usePathname();
    const isPetWindow = pathname === DESKTOP_PET_ROUTE;

    useEffect(() => {
        if (!isPetWindow || !isTauriDesktop()) return;
        let disposed = false;
        const cleanups: Array<() => void> = [];

        void (async () => {
            const [{ invoke }, { listen }, { getCurrentWindow }] = await Promise.all([
                import('@tauri-apps/api/core'),
                import('@tauri-apps/api/event'),
                import('@tauri-apps/api/window'),
            ]);
            if (disposed) return;

            const applyLocked = (locked: boolean) => {
                document.documentElement.dataset.desktopPet = locked ? 'locked' : 'true';
            };

            const current = await invoke<DesktopSettings>('get_desktop_settings');
            if (disposed) return;
            applyLocked(current.locked);

            cleanups.push(
                await listen<DesktopSettings>('desktop-settings-changed', event => {
                    applyLocked(event.payload.locked);
                }),
            );

            cleanups.push(
                await listen<string>('pet-command', event => {
                    if (event.payload === 'walk') {
                        // 复用宠物自己的动作总线，不另开一条路径。
                        window.dispatchEvent(new CustomEvent('kitty-pet-action', {
                            detail: { action: 'walking', duration: 2600 },
                        }));
                    }
                }),
            );

            // 拖动结束后存一次位置。用 moved 事件而不是 pointerup——
            // 窗口是被系统拖的，网页根本收不到那个 pointerup。
            let saveTimer: ReturnType<typeof setTimeout> | null = null;
            cleanups.push(
                await getCurrentWindow().onMoved(() => {
                    if (saveTimer) clearTimeout(saveTimer);
                    // 拖动过程中 moved 会连发几十次，防抖一下再写盘。
                    saveTimer = setTimeout(() => { void invoke('remember_pet_position'); }, 400);
                }),
            );
            cleanups.push(() => { if (saveTimer) clearTimeout(saveTimer); });
        })();

        return () => {
            disposed = true;
            cleanups.forEach(fn => fn());
        };
    }, [isPetWindow]);

    return null;
}
