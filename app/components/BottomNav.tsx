'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Home,
    BookHeart,
    StickyNote,
    Image as ImageIcon,
    Sparkles,
    Mail,
    Map as MapIcon,
    MessageCircleHeart,
    MessageCircleQuestion,
    MessagesSquare,
    SmilePlus,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import ThemeToggle from './ui/ThemeToggle';
import { useChatUnread } from './ChatMediationProvider';

const navItems = [
    { href: '/', label: '首页', icon: Home },
    { href: '/guestbook', label: '留言', icon: BookHeart },
    { href: '/plan', label: '计划', icon: StickyNote },
    { href: '/gallery', label: '相册', icon: ImageIcon },
    { href: '/timeline', label: '故事', icon: Sparkles },
    { href: '/map', label: '地图', icon: MapIcon },
    { href: '/daily-question', label: '一问', icon: MessageCircleQuestion },
    { href: '/mood', label: '心情', icon: SmilePlus },
    { href: '/letters', label: '情书', icon: Mail },
    { href: '/chat', label: '聊天', icon: MessagesSquare },
    { href: '/companion', label: '对话本', icon: MessageCircleHeart },
];

/**
 * 全站统一底部导航（替代旧的双套气泡菜单）。
 * 玻璃拟态 pill，桌面/移动同一形态；active 项粉色高亮。
 */
export default function BottomNav() {
    const pathname = usePathname();
    const unreadCount = useChatUnread();

    // 后台与验证页不显示
    if (pathname?.startsWith('/admin') || pathname?.startsWith('/verify')) return null;

    return (
        <nav
            aria-label="主导航"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--z-nav)]"
        >
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                // 六个入口在 360px 窄屏上刚好挤得下；再多就靠横向滚动兜底，
                // 而不是让胶囊溢出到屏幕外。
                className="flex max-w-[calc(100vw-1rem)] items-center gap-1 overflow-x-auto rounded-full border border-ink/5 bg-surface/75 px-2 py-1.5 shadow-lift backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                        item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                                'relative flex shrink-0 flex-col items-center gap-0.5 rounded-full px-2.5 py-1.5 min-w-[48px] sm:px-3.5 sm:min-w-[56px]',
                                'transition-colors duration-200',
                                isActive ? 'text-on-accent' : 'text-ink-muted hover:text-ink'
                            )}
                        >
                            {isActive && (
                                <motion.span
                                    layoutId="nav-active-pill"
                                    className="absolute inset-0 rounded-full bg-accent shadow-soft"
                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                />
                            )}
                            <span className="relative">
                                <Icon size={20} />
                                {item.href === '/chat' && unreadCount > 0 && (
                                    <span
                                        aria-hidden="true"
                                        className="absolute -top-1 -right-1.5 min-w-[14px] rounded-full bg-danger px-[3px] text-center text-[9px] font-bold leading-[14px] text-on-accent"
                                    >
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </span>
                            <span className="relative text-[11px] leading-none font-medium">
                                {item.label}
                                {item.href === '/chat' && unreadCount > 0 && (
                                    <span className="sr-only">，{unreadCount} 条未读</span>
                                )}
                            </span>
                        </Link>
                    );
                })}
                <div className="mx-1 h-6 w-px bg-sunken" aria-hidden />
                <ThemeToggle className="h-9 w-9" />
            </motion.div>
        </nav>
    );
}
