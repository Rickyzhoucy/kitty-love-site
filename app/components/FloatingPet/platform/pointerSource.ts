'use client';

/**
 * 指针来源抽象（实施计划 §9 第 1 点）。
 *
 * Web 端的指针是 DOM `pointermove`，坐标相对页面视口。桌面端（Tauri）的指针
 * 来自 Rust 侧的全局鼠标钩子，坐标相对**屏幕**，而且宠物窗口自己也在移动——
 * 「鼠标在宠物左边还是右边」这个判断在两端的算法根本不同。
 *
 * 所以行为脑不能直接监听 DOM 事件。它订阅这个接口，两端各给一个实现。
 *
 * 这一步**不实现桌面版**，只是把边界划出来，避免将来返工时要动行为脑本身。
 */

export interface PointerPosition {
    /** 与宠物同一坐标系的横坐标 */
    x: number;
    y: number;
}

export interface PointerSource {
    /**
     * 订阅指针移动。返回退订函数。
     *
     * 实现方负责节流——行为脑收到多少次就处理多少次，不做二次防抖。
     */
    subscribe(listener: (position: PointerPosition) => void): () => void;
}

/** Web 端实现：DOM pointermove，坐标即视口坐标。 */
export function createDomPointerSource(): PointerSource {
    return {
        subscribe(listener) {
            if (typeof window === 'undefined') return () => {};
            const handle = (event: PointerEvent) => {
                listener({ x: event.clientX, y: event.clientY });
            };
            window.addEventListener('pointermove', handle, { passive: true });
            return () => window.removeEventListener('pointermove', handle);
        },
    };
}

/**
 * 桌面端实现的占位。
 *
 * 真实实现需要 Rust 侧把全局鼠标位置推过来，并减去宠物窗口自身的屏幕坐标，
 * 才能得到与 Web 端同义的相对坐标。这里刻意抛错而不是静默返回空实现——
 * 桌面版接上来的那天，忘了替换应该立刻炸，而不是宠物默默不再看人。
 */
export function createDesktopPointerSource(): PointerSource {
    return {
        subscribe() {
            throw new Error(
                '桌面端 PointerSource 尚未实现：需要 Rust 侧的全局鼠标位置，'
                + '并减去宠物窗口的屏幕坐标',
            );
        },
    };
}
