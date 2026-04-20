"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookHeart, StickyNote, Image as ImageIcon, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import styles from './Navbar.module.css';

const navItems = [
    { href: '/', label: '首页', icon: Home, color: '#ff758c' },
    { href: '/guestbook', label: '留言板', icon: BookHeart, color: '#ff758c' },
    { href: '/memo', label: '备忘录', icon: StickyNote, color: '#4DD0E1' },
    { href: '/gallery', label: '照片墙', icon: ImageIcon, color: '#FFB74D' },
    { href: '/timeline', label: '我们的故事', icon: Sparkles, color: '#BA68C8' },
];

export default function Navbar() {
    const pathname = usePathname();

    // Hide navbar on admin pages and homepage (homepage has its own menu)
    if (pathname?.startsWith('/admin') || pathname === '/') return null;

    return (
        <motion.nav 
            className={styles.dockContainer}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
            <div className={styles.dock}>
                {navItems.map((item, index) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    return (
                        <Link href={item.href} key={item.href} className={styles.dockItemWrapper}>
                            <motion.div
                                className={`${styles.dockItem} ${isActive ? styles.active : ''}`}
                                whileHover={{ scale: 1.2, y: -10 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <div 
                                    className={styles.iconContainer}
                                    style={{ 
                                        background: isActive ? `linear-gradient(135deg, ${item.color}80, ${item.color})` : 'transparent',
                                        color: isActive ? 'white' : '#666',
                                        boxShadow: isActive ? `0 8px 16px ${item.color}40` : 'none'
                                    }}
                                >
                                    <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                {!isActive && <span className={styles.tooltip}>{item.label}</span>}
                            </motion.div>
                            {isActive && <motion.div layoutId="dockIndicator" className={styles.indicator} style={{ backgroundColor: item.color }} />}
                        </Link>
                    );
                })}
            </div>
        </motion.nav>
    );
}
