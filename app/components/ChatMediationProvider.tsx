'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { fetchThread, runMediation, type PetInterjection } from '@/lib/api/chatDirect';
import { subscribeServerEvent } from '@/lib/api/events';

/**
 * 未读数轮询与宠物中介的唯一入口，站点级挂载（见 layout.tsx）。
 *
 * 这两件事以前都长在 `/chat` 页面里，但那页一打开就会把未读清零——催促
 * 永远赶不上「已读」，等于一条永远不会被真人看到的死代码路径。挪到这里
 * 之后，未读徽标（BottomNav）与宠物的主动搭话在你不在 `/chat` 页面时才
 * 有意义，所以这两个效果都在 `/chat` 上暂停。
 */

const UNREAD_POLL_MS = 60_000;
const MEDIATION_INTERVAL_MS = 30_000;

interface ChatMediationState {
    unreadCount: number;
    nudge: PetInterjection | null;
    consumeNudge: () => void;
}

const ChatMediationContext = createContext<ChatMediationState>({
    unreadCount: 0,
    nudge: null,
    consumeNudge: () => {},
});

export function useChatUnread(): number {
    return useContext(ChatMediationContext).unreadCount;
}

/** 宠物用这个取走待说的中介插话；取走后自动清空，避免同一条被说两遍。 */
export function useChatNudge(): [PetInterjection | null, () => void] {
    const { nudge, consumeNudge } = useContext(ChatMediationContext);
    return [nudge, consumeNudge];
}

export default function ChatMediationProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    // 后台/验证页没有登录态或与本功能无关；/chat 页面自己会立刻标已读。
    const paused =
        pathname?.startsWith('/admin') || pathname?.startsWith('/verify') || pathname?.startsWith('/chat');
    const [unreadCount, setUnreadCount] = useState(0);
    const [nudge, setNudge] = useState<PetInterjection | null>(null);

    // 用 .then 而不是 async/await：setState 得留在回调里，effect 主体自己不能
    // 直接落到 setState 上（react-hooks/set-state-in-effect）。
    const refresh = useCallback(() => {
        fetchThread()
            .then(thread => setUnreadCount(thread.unreadCount))
            .catch(() => {
                // 没配对账号或网络问题——徽标不是关键路径，静默即可
            });
    }, []);

    useEffect(() => {
        if (paused) return;
        refresh();
        const timer = setInterval(refresh, UNREAD_POLL_MS);
        const unsubscribe = subscribeServerEvent('chat.message', refresh);
        return () => {
            clearInterval(timer);
            unsubscribe();
        };
    }, [paused, refresh]);

    // 只在真有未读时才跑中介——没有未读时轮询这个接口没有意义。
    useEffect(() => {
        if (paused || unreadCount === 0) return;
        const initiative =
            (localStorage.getItem('companionPetInitiative') as
                | 'normal' | 'quiet' | 'off' | null) ?? 'normal';
        const tick = () => {
            void runMediation(initiative)
                .then(created => {
                    if (!created.length) return;
                    setNudge(created[created.length - 1]);
                    void refresh();
                })
                .catch(() => {
                    // 中介失败不影响其它功能
                });
        };
        tick();
        const timer = setInterval(tick, MEDIATION_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [paused, unreadCount, refresh]);

    const consumeNudge = useCallback(() => setNudge(null), []);

    return (
        <ChatMediationContext.Provider value={{ unreadCount, nudge, consumeNudge }}>
            {children}
        </ChatMediationContext.Provider>
    );
}
