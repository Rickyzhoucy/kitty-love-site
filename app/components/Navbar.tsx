"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookHeart, StickyNote, Image as ImageIcon, Sparkles } from 'lucide-react';
import styles from './Navbar.module.css';
import { cn } from '@/lib/utils';

const navItems = [
    { href: '/', label: '首页', icon: Home },
    { href: '/guestbook', label: '留言板', icon: BookHeart },
    { href: '/memo', label: '备忘录', icon: StickyNote },
    { href: '/gallery', label: '照片墙', icon: ImageIcon },
    { href: '/timeline', label: '我们的故事', icon: Sparkles },
];

export default function Navbar() {
    const pathname = usePathname();

    // Hide navbar on admin pages and homepage
    if (pathname?.startsWith('/admin') || pathname === '/') return null;

    return (
        <nav className={styles.navbar}>
            <div className={styles.container}>
                {/* Hello Kitty Mini Logo */}
                <div className={styles.brandIcon}>
                    <img
                        src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                        alt="Hello Kitty"
                    />
                </div>

                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(styles.navItem, isActive && styles.active)}
                        >
                            <div className={styles.iconWrapper}>
                                <Icon size={22} strokeWidth={2.5} />
                            </div>
                            <span className={styles.label}>{item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
