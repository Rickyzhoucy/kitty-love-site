'use client';

/**
 * 环境感知抽象（实施计划 §9 第 2 点，架构文档 §8）。
 *
 * 「宠物要避开的矩形」在两端语义完全不同：
 *
 * - Web 端：底部导航、聊天面板、模态框——都是页面内的 DOM 元素。
 * - 桌面端：屏幕边缘、Dock、菜单栏——都是操作系统的东西，DOM 里查不到。
 *
 * 宠物核心只消费一个矩形列表和一个活动区域，不关心它们从哪来。
 */

export interface EnvironmentRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface EnvironmentProvider {
    /** 宠物可以待的范围。Web 端是视口，桌面端是屏幕工作区。 */
    viewport(): EnvironmentRect;
    /** 需要避开的矩形。宠物不会主动走进这些区域。 */
    obstacles(): EnvironmentRect[];
    /** 环境变化时通知（窗口缩放、面板开合、显示器切换）。 */
    subscribe(listener: () => void): () => void;
}

/**
 * Web 端实现。
 *
 * 障碍物由 `data-pet-obstacle` 属性声明，而不是在这里硬编码选择器列表——
 * 加一个新面板时应该在那个面板上加个属性，而不是回来改这个文件。
 */
export const OBSTACLE_ATTRIBUTE = 'data-pet-obstacle';

export function createDomEnvironmentProvider(): EnvironmentProvider {
    return {
        viewport() {
            if (typeof window === 'undefined') {
                return { left: 0, top: 0, right: 0, bottom: 0 };
            }
            return {
                left: 0,
                top: 0,
                right: window.innerWidth,
                bottom: window.innerHeight,
            };
        },
        obstacles() {
            if (typeof document === 'undefined') return [];
            return Array.from(
                document.querySelectorAll(`[${OBSTACLE_ATTRIBUTE}]`),
            ).map(element => {
                const box = element.getBoundingClientRect();
                return {
                    left: box.left,
                    top: box.top,
                    right: box.right,
                    bottom: box.bottom,
                };
            });
        },
        subscribe(listener) {
            if (typeof window === 'undefined') return () => {};
            window.addEventListener('resize', listener);
            // 面板开合不会触发 resize，用 ResizeObserver 盯住 body 的布局变化。
            const observer = new ResizeObserver(listener);
            observer.observe(document.body);
            return () => {
                window.removeEventListener('resize', listener);
                observer.disconnect();
            };
        },
    };
}

/** 两个矩形是否相交。宠物落点判定用。 */
export function intersects(a: EnvironmentRect, b: EnvironmentRect): boolean {
    return !(
        a.right <= b.left
        || a.left >= b.right
        || a.bottom <= b.top
        || a.top >= b.bottom
    );
}

/**
 * 把一个点夹进可用区域，并推离障碍物。
 *
 * 推离方向取「离开当前障碍最近的一边」。刻意不做多障碍联合求解——
 * 那需要真正的寻路，而宠物只需要「别站在聊天面板上」这种程度的回避。
 */
export function clampToEnvironment(
    box: EnvironmentRect,
    environment: EnvironmentProvider,
    margin = 8,
): { x: number; y: number } {
    const viewport = environment.viewport();
    const width = box.right - box.left;
    const height = box.bottom - box.top;

    let x = Math.max(
        viewport.left + margin,
        Math.min(viewport.right - width - margin, box.left),
    );
    let y = Math.max(
        viewport.top + margin,
        Math.min(viewport.bottom - height - margin, box.top),
    );

    for (const obstacle of environment.obstacles()) {
        const current = { left: x, top: y, right: x + width, bottom: y + height };
        if (!intersects(current, obstacle)) continue;
        const pushes = [
            { axis: 'x' as const, value: obstacle.left - width - margin, cost: current.right - obstacle.left },
            { axis: 'x' as const, value: obstacle.right + margin, cost: obstacle.right - current.left },
            { axis: 'y' as const, value: obstacle.top - height - margin, cost: current.bottom - obstacle.top },
            { axis: 'y' as const, value: obstacle.bottom + margin, cost: obstacle.bottom - current.top },
        ].sort((left, right) => left.cost - right.cost);
        const best = pushes[0];
        if (best.axis === 'x') x = best.value;
        else y = best.value;
    }

    return {
        x: Math.max(viewport.left + margin, Math.min(viewport.right - width - margin, x)),
        y: Math.max(viewport.top + margin, Math.min(viewport.bottom - height - margin, y)),
    };
}

/**
 * 桌面端实现的占位。
 *
 * 真实实现要从 Tauri 拿当前显示器的工作区（已排除 Dock 与菜单栏），
 * 障碍物则来自其它置顶窗口。与 Web 端的区别大到不能共用一份实现。
 */
export function createDesktopEnvironmentProvider(): EnvironmentProvider {
    throw new Error(
        '桌面端 EnvironmentProvider 尚未实现：需要 Tauri 的显示器工作区与置顶窗口列表',
    );
}
