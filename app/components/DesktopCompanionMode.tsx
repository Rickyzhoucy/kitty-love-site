'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { DESKTOP_PET_ROUTE } from '@/lib/desktopPet';

/**
 * 按路由决定这个窗口是「站点」还是「宠物」。
 *
 * ## 改成两个窗口之后这里做什么
 *
 * 以前是「在 Tauri 里就把页面藏掉」——一个窗口两种形态，于是**看照片的时候
 * 桌面上就没有宠物了**。现在宠物有自己的窗口，判断依据从「是不是 Tauri」
 * 变成了**「是哪个路由」**：
 *
 * - `/desktop-pet` → 只留宠物，背景透明（`data-desktop-pet`）
 * - 其余路由 → 正常站点，浏览器里和桌面里长得一样
 *
 * 顺带一个好处：这个形态在**浏览器里直接能验**——打开
 * `localhost:3000/desktop-pet` 就是宠物窗口的真实样子，不用先装 Rust 工具链
 * 编译一遍才能看到。
 */
export default function DesktopChrome() {
    const pathname = usePathname();
    const isPetWindow = pathname === DESKTOP_PET_ROUTE;

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.desktopPet = isPetWindow ? 'true' : 'false';
        return () => {
            root.dataset.desktopPet = 'false';
        };
    }, [isPetWindow]);

    return null;
}
