'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { isTauriDesktop } from '@/lib/desktop';

export default function DesktopCompanionMode() {
    const pathname = usePathname();
    useEffect(() => {
        const enabled = isTauriDesktop() && !pathname.startsWith('/verify');
        document.documentElement.dataset.desktopCompanion = enabled ? 'true' : 'false';
        return () => {
            document.documentElement.dataset.desktopCompanion = 'false';
        };
    }, [pathname]);

    return (
        <div className="desktop-drag-handle" data-tauri-drag-region>
            拖动桌宠
        </div>
    );
}
