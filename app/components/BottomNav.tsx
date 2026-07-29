'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookHeart, StickyNote, Image as ImageIcon, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import ThemeToggle from './ui/ThemeToggle';

const navItems = [
    { href: '/', label: '首页', icon: Home },
    { href: '/guestbook', label: '留言', icon: BookHeart },
    { href: '/memo', label: '备忘', icon: StickyNote },
    { href: '/gallery', label: '相册', icon: ImageIcon },
    { href: '/timeline', label: '故事', icon: Sparkles },
];

/**
 * 全站统一底部导航（替代旧的双套气泡菜单）。
 * 玻璃拟态 pill，桌面/移动同一形态；active 项粉色高亮。
 */
export default function BottomNav() {
    const pathname = usePathname();

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
                className="flex items-center gap-1 rounded-full border border-ink/5 bg-surface/75 backdrop-blur-xl shadow-lift px-2 py-1.5"
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
                                'relative flex flex-col items-center gap-0.5 rounded-full px-3.5 py-1.5 min-w-[56px]',
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
                            <Icon size={20} className="relative" />
                            <span className="relative text-[11px] leading-none font-medium">
                                {item.label}
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
