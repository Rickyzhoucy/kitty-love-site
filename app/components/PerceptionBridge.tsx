'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { isTauriDesktop } from '@/lib/desktop';
import { DESKTOP_PET_ROUTE } from '@/lib/desktopPet';
import {
    emitPerceptionEvent,
    type PagePerceptionContext,
    type PerceptionSurface,
    writePerceptionSession,
} from '@/lib/api/perception';

const LEGACY_DEVICE_KEY = 'kittyPerceptionDeviceId';
const SESSION_KEY = 'kittyPerceptionSessionId';
const REVISION_KEY = 'kittyPerceptionSessionRevision';
const CONVERSATION_KEY = 'companionConversationId';
const HEARTBEAT_MS = 30_000;

const PAGE_CONTEXTS: Record<string, PagePerceptionContext> = {
    '/': { pageTitle: '我们的小世界', section: '关系概览', interactionMode: 'browse' },
    '/timeline': { pageTitle: '故事线', section: '共同经历与地点', interactionMode: 'browse_edit' },
    '/gallery': { pageTitle: '相册', section: '共同照片', interactionMode: 'browse_edit' },
    '/plan': { pageTitle: '计划与心愿', section: '计划、心愿和纪念日', interactionMode: 'browse_edit' },
    '/chat': { pageTitle: '两个人的聊天', section: '私聊线程', interactionMode: 'conversation' },
    '/guestbook': { pageTitle: '留言板', section: '共同留言', interactionMode: 'browse_edit' },
    '/companion': { pageTitle: '宠物小窝', section: '心情、每日一问与未来情书', interactionMode: 'ritual' },
    '/settings': { pageTitle: '设置与记忆', section: '账号、桌宠与记忆治理', interactionMode: 'settings' },
    '/desktop-pet': { pageTitle: '桌面宠物', section: '宠物浮窗', interactionMode: 'companion' },
};

function sessionId(): string {
    // A browser tab is one perception surface. Sharing a localStorage id made
    // multiple tabs overwrite each other's current page, and a hard reload reset
    // the in-memory revision so every later heartbeat was rejected as stale.
    localStorage.removeItem(LEGACY_DEVICE_KEY);
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
}

function nextRevision(): number {
    const stored = Number(sessionStorage.getItem(REVISION_KEY) ?? '0');
    const next = Number.isSafeInteger(stored) && stored >= 0 ? stored + 1 : 1;
    sessionStorage.setItem(REVISION_KEY, String(next));
    return next;
}

function surface(pathname: string): PerceptionSurface {
    if (!isTauriDesktop()) return 'web';
    return pathname === DESKTOP_PET_ROUTE ? 'tauri_pet' : 'tauri_main';
}

/**
 * Whole-site semantic awareness. Pages may enrich it through setPagePerception();
 * raw DOM, form drafts, local filesystem state and credentials never leave the client.
 */
export default function PerceptionBridge() {
    const pathname = usePathname();
    const contextRef = useRef<PagePerceptionContext>({});
    const conversationRef = useRef<string | null>(null);

    useEffect(() => {
        if (pathname.startsWith('/admin') || pathname.startsWith('/verify')) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let conversationTimer: ReturnType<typeof setInterval> | null = null;
        const currentSurface = surface(pathname);
        contextRef.current = PAGE_CONTEXTS[pathname] ?? {
            pageTitle: '站内页面',
            section: pathname,
            interactionMode: 'browse',
        };
        conversationRef.current = localStorage.getItem(CONVERSATION_KEY);

        const sync = async () => {
            if (stopped) return;
            if (timer) clearTimeout(timer);
            timer = null;
            try {
                await writePerceptionSession({
                    deviceSessionId: sessionId(),
                    surface: currentSurface,
                    route: pathname,
                    pageKind: pathname.slice(1) || 'home',
                    pageContext: contextRef.current,
                    activeConversationId: conversationRef.current,
                    foreground: currentSurface !== 'tauri_pet' && !document.hidden,
                    revision: nextRevision(),
                });
            } catch {
                // Awareness is additive. A heartbeat outage must never break page use.
            } finally {
                if (!stopped) timer = setTimeout(() => { void sync(); }, HEARTBEAT_MS);
            }
        };
        const onContext = (event: Event) => {
            const detail = (event as CustomEvent<PagePerceptionContext>).detail;
            if (!detail || typeof detail !== 'object') return;
            contextRef.current = { ...contextRef.current, ...detail };
            if (timer) clearTimeout(timer);
            void sync();
        };
        const onVisibility = () => {
            if (timer) clearTimeout(timer);
            void sync();
        };
        window.addEventListener('kitty:perception-context', onContext);
        document.addEventListener('visibilitychange', onVisibility);
        // localStorage's storage event does not fire in the window that made the
        // change. A tiny change detector keeps the main view and pet window aligned.
        conversationTimer = setInterval(() => {
            const current = localStorage.getItem(CONVERSATION_KEY);
            if (current === conversationRef.current) return;
            conversationRef.current = current;
            void sync();
        }, 2_000);
        void sync();
        void emitPerceptionEvent({
            type: 'site.page.viewed',
            subjectType: 'page',
            subjectId: pathname,
            data: {
                route: pathname,
                pageTitle: contextRef.current.pageTitle ?? '站内页面',
                section: contextRef.current.section ?? '',
            },
            retention: 'working',
            dedupeKey: `page:${sessionId()}:${pathname}:${Math.floor(Date.now() / 60_000)}`,
        }).catch(() => {});
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            if (conversationTimer) clearInterval(conversationTimer);
            window.removeEventListener('kitty:perception-context', onContext);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pathname]);

    return null;
}
