'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isTauriDesktop } from '@/lib/desktop';
import { DESKTOP_PET_ROUTE, type DesktopSettings } from '@/lib/desktopPet';

/**
 * 宠物窗口和 Rust 侧之间的那几根线。**只在宠物窗口里生效。**
 *
 * 做四件事：
 *
 * 0. **告诉 Rust「可以露面了」。** 宠物窗口一律先建成隐藏的，只有这里确认
 *    会话有效之后才显示。第一版没有这道闸，未登录时中间件把窗口重定向到登录页，
 *    结果一个填不了（输入框在两百像素外）也关不掉（无边框置顶）的登录框
 *    飘在所有窗口最上面。**任何异常都该表现为「没有窗口」，而不是「怪窗口」。**
 * 1. **把锁定状态同步到 DOM。** Rust 那边开的是整窗鼠标穿透
 *    （`set_ignore_cursor_events`），但网页自己并不知道被锁了——不同步的话
 *    宠物还会跟着鼠标做悬停反应，看着像"活的却点不动"，很怪。
 * 2. **接托盘发来的命令**（目前只有「走两步」）。动作逻辑留在前端，
 *    Rust 只发信号，不在两边各写一套步态。
 * 3. **记住窗口被拖到哪了。** 宠物本体在左键按下时调用 Tauri 的
 *    `startDragging()`；系统拖完后要存一次位置，否则下次启动它又回到原点。
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

            // 锁定状态写在**另一个属性**上。写进 data-desktop-pet 的话会把
            // 「是不是宠物窗口」那套按 `="true"` 匹配的透明/布局规则整体顶掉，
            // 一锁定窗口就变成不透明的方块（见 globals.css 那段注释）。
            const applyLocked = (locked: boolean) => {
                document.documentElement.dataset.petLocked = locked ? 'true' : 'false';
            };
            const applyWindowBaseSize = (petSize: number) => {
                document.documentElement.style.setProperty(
                    '--desktop-pet-window-base',
                    `${petSize}px`,
                );
            };

            const current = await invoke<DesktopSettings>('get_desktop_settings');
            if (disposed) return;
            applyLocked(current.locked);
            applyWindowBaseSize(current.petSize);

            /**
             * 会话有效吗？有效才让窗口露面。
             *
             * 没登录时不停地问一遍——用户此刻多半正在主窗口里登录，登完这边
             * 自己就亮出来了，不用他再去托盘点一下「显示宠物」。
             */
            const checkSession = async (): Promise<boolean> => {
                try {
                    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
                    return response.ok;
                } catch {
                    return false;
                }
            };

            let pollTimer: ReturnType<typeof setTimeout> | null = null;
            const settle = async () => {
                if (disposed) return;
                const ok = await checkSession();
                if (disposed) return;
                await invoke('set_pet_ready', { ready: ok });
                if (!ok) pollTimer = setTimeout(() => { void settle(); }, 3000);
            };
            void settle();
            cleanups.push(() => { if (pollTimer) clearTimeout(pollTimer); });

            cleanups.push(
                await listen<DesktopSettings>('desktop-settings-changed', event => {
                    applyLocked(event.payload.locked);
                    applyWindowBaseSize(event.payload.petSize);
                }),
            );

            cleanups.push(
                await listen<string>('pet-context-command', event => {
                    window.dispatchEvent(new CustomEvent('kitty-pet-context-command', {
                        detail: event.payload,
                    }));
                }),
            );

            // 自由行动时窗口是 Rust 在挪，网页这边完全不知道自己在动——
            // 不转发的话，宠物会一路「站着」滑过整个桌面，像被拖走的贴纸。
            cleanups.push(
                await listen<{ moving: boolean; facing: 'left' | 'right' }>('pet-roam', event => {
                    window.dispatchEvent(new CustomEvent('kitty-pet-roam', {
                        detail: event.payload,
                    }));
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
