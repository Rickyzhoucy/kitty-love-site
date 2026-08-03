'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isTauriDesktop } from '@/lib/desktop';
import { DESKTOP_PET_ROUTE, type DesktopSettings } from '@/lib/desktopPet';

/**
 * 本地执行器：把云端派来的文件读取请求在这台电脑上做掉。
 *
 * ## 为什么挂在宠物窗口上
 *
 * 需要一个「只要桌面版开着就一直在跑」的地方。宠物窗口正好是那个——它就是
 * 桌面版存在的意义，主窗口关了它还在。挂在主窗口上的话，用户一收起主界面
 * 执行器就没了，而宠物还在桌面上，看着像活的却什么也做不了。
 *
 * ## 为什么要先注册再干活
 *
 * 云端派发时要挑一台在线的机器。没注册过、或者心跳断了的机器不参与派发——
 * 否则会派给一台早就关机的电脑，然后整轮对话干等到超时。
 *
 * ## 认领是原子的，所以这里可以放心地"看到就抢"
 *
 * 两台电脑同时收到通知也没关系：认领接口那条
 * `UPDATE ... WHERE state='pending'` 只会让一台拿到参数（见
 * backend/app/local_executor.py）。这里不需要自己去做互斥。
 */
export default function DesktopExecutorLoop() {
    const pathname = usePathname();
    const isPetWindow = pathname === DESKTOP_PET_ROUTE;

    useEffect(() => {
        if (!isPetWindow || !isTauriDesktop()) return;
        let disposed = false;
        let executorId: string | null = null;
        const cleanups: Array<() => void> = [];

        void (async () => {
            const [{ invoke }, { listen }] = await Promise.all([
                import('@tauri-apps/api/core'),
                import('@tauri-apps/api/event'),
            ]);
            if (disposed) return;

            /** 注册 / 续心跳。白名单一并报上去，服务端只拿它展示。 */
            const register = async (): Promise<string | null> => {
                try {
                    const settings = await invoke<DesktopSettings>('get_desktop_settings');
                    const response = await fetch('/api/v1/desktop/executors', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: deviceName(),
                            allowedRoots: settings.allowedRoots ?? [],
                        }),
                    });
                    if (!response.ok) return null;
                    return (await response.json()).executorId as string;
                } catch {
                    return null;
                }
            };

            /** 把队列里的活儿全做完。可能一次通知对应好几条。 */
            const drain = async () => {
                if (disposed || !executorId) return;
                for (let i = 0; i < 10; i += 1) {
                    let claimed: { callId: string; tool: string; arguments: Record<string, unknown> } | null = null;
                    try {
                        const response = await fetch(
                            `/api/v1/desktop/executors/${executorId}/claim`,
                            { method: 'POST', credentials: 'include' },
                        );
                        if (!response.ok) return;
                        claimed = await response.json();
                    } catch {
                        return;
                    }
                    if (!claimed) return; // 队列空了

                    let result: unknown = null;
                    let error: string | null = null;
                    try {
                        // 真正的执行和白名单校验都在 Rust 那边（src-tauri/src/local_fs.rs）。
                        // 这一层碰不到文件系统，也决定不了能读哪儿。
                        result = await invoke('run_local_tool', {
                            tool: claimed.tool,
                            arguments: claimed.arguments,
                        });
                    } catch (thrown) {
                        // Rust 侧的拒绝理由是给模型看的人话，原样带回去。
                        error = String(thrown);
                    }
                    await fetch(`/api/v1/desktop/executors/${executorId}/result`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ callId: claimed.callId, result, error }),
                    }).catch(() => {});
                }
            };

            executorId = await register();
            if (disposed) return;

            // 心跳。断了之后云端就不再派活儿给这台机器——这正是我们要的，
            // 总比派给一台关了的电脑然后干等超时强。
            const heartbeat = setInterval(() => {
                void (async () => {
                    executorId = (await register()) ?? executorId;
                })();
            }, 30_000);
            cleanups.push(() => clearInterval(heartbeat));

            cleanups.push(
                await listen<{ executorId: string }>('local_tool_call', event => {
                    // 事件是广播给这个用户所有连接的，所以要认一下是不是派给自己的。
                    if (event.payload?.executorId === executorId) void drain();
                }),
            );

            // 兜底轮询：SSE 断线重连的空档里派下来的活儿，靠这个捡回来。
            const sweep = setInterval(() => void drain(), 15_000);
            cleanups.push(() => clearInterval(sweep));
            void drain();
        })();

        return () => {
            disposed = true;
            cleanups.forEach(fn => fn());
        };
    }, [isPetWindow]);

    return null;
}

/** 机器名。服务端按 (用户, 名字) 认同一台机器，所以要稳定。 */
function deviceName(): string {
    if (typeof navigator === 'undefined') return '这台电脑';
    const ua = navigator.userAgent;
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows 电脑';
    if (/Linux/.test(ua)) return 'Linux 电脑';
    return '这台电脑';
}
