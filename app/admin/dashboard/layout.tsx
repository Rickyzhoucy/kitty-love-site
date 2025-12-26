"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, MessageCircle, StickyNote, Image as ImageIcon, Star, LogOut } from 'lucide-react';
import styles from './dashboard.module.css';

const navItems = [
    { href: '/admin/dashboard', label: '概览', icon: LayoutDashboard },
    { href: '/admin/dashboard/messages', label: '留言管理', icon: MessageCircle },
    { href: '/admin/dashboard/memos', label: '备忘录', icon: StickyNote },
    { href: '/admin/dashboard/photos', label: '照片墙', icon: ImageIcon },
    { href: '/admin/dashboard/milestones', label: '里程碑', icon: Star },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [isAuthorized, setIsAuthorized] = useState(false);

    useEffect(() => {
        // Simple cookie check
        const auth = document.cookie.split('; ').find(row => row.startsWith('admin_auth='));
        if (!auth || auth.split('=')[1] !== 'true') {
            router.push('/admin');
        } else {
            setIsAuthorized(true);
        }
    }, [router]);

    const handleLogout = () => {
        document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        router.push('/admin');
    };

    if (!isAuthorized) return null; // Or a loading spinner

    return (
        <div className={styles.container}>
            <aside className={styles.sidebar}>
                <div className={styles.logo}>
                    <img
                        src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                        alt="Hello Kitty"
                        style={{ width: '80px', height: 'auto', marginBottom: '10px' }}
                    />
                    <h2>Hello Admin 🎀</h2>
                </div>
                <nav className={styles.nav}>
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                            >
                                <Icon size={20} />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
                <button onClick={handleLogout} className={styles.logoutBtn}>
                    <LogOut size={20} />
                    <span>退出登录</span>
                </button>
            </aside>
            <main className={styles.main}>
                {children}
            </main>
        </div>
    );
}
