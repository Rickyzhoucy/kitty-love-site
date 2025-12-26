"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookHeart, StickyNote, Image as ImageIcon, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import styles from './Navbar.module.css';

const navItems = [
    { href: '/', label: '首页', icon: Home, color: '#F48FB1' },
    { href: '/guestbook', label: '留言板', icon: BookHeart, color: '#F48FB1' },
    { href: '/memo', label: '备忘录', icon: StickyNote, color: '#4DD0E1' },
    { href: '/gallery', label: '照片墙', icon: ImageIcon, color: '#FFB74D' },
    { href: '/timeline', label: '我们的故事', icon: Sparkles, color: '#BA68C8' },
];

export default function Navbar() {
    const pathname = usePathname();

    // Hide navbar on admin pages and homepage (homepage has its own menu)
    if (pathname?.startsWith('/admin') || pathname === '/') return null;

    return (
        <div className={styles.floatingMenu}>
            {navItems.map((item, index) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                    <motion.div
                        key={item.href}
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + index * 0.1 }}
                    >
                        <Link href={item.href} className={styles.bubbleItem}>
                            <div
                                className={`${styles.bubbleIcon} ${isActive ? styles.active : ''}`}
                                style={{ backgroundColor: item.color }}
                            >
                                <Icon size={20} color="white" />
                            </div>
                            <span className={styles.bubbleLabel}>{item.label}</span>
                        </Link>
                    </motion.div>
                );
            })}
        </div>
    );
}
