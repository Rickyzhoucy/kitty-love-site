'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isTauriDesktop } from '@/lib/desktop';
import { DESKTOP_PET_ROUTE } from '@/lib/desktopPet';

const FloatingPet = dynamic(
    () => import('./FloatingPet/FloatingPet'),
    { ssr: false }
);

export default function FloatingPetWrapper() {
    const pathname = usePathname();

    // Tauri 已经有一个独立、常驻的 `pet` 窗口。主窗口再挂载一份 FloatingPet
    // 不只是“看见两只”：两边还会各自启动主动行为、定时动作和消息监听。
    // 因此桌面主窗口直接不挂载组件；浏览器版照常显示，独立宠物路由也照常显示。
    if (isTauriDesktop() && pathname !== DESKTOP_PET_ROUTE) return null;

    return <FloatingPet />;
}
