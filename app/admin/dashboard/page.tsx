"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, StickyNote, Image as ImageIcon, Star, Lock, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function DashboardOverview() {
    const [counts, setCounts] = useState({ messages: 0, memos: 0, photos: 0, milestones: 0 });
    const router = useRouter();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [msgRes, memoRes, photoRes, mileRes] = await Promise.all([
                    fetch('/api/messages'),
                    fetch('/api/memos'),
                    fetch('/api/photos'),
                    fetch('/api/milestones')
                ]);

                const msgs = await msgRes.json();
                const memos = await memoRes.json();
                const photos = await photoRes.json();
                const miles = await mileRes.json();

                setCounts({
                    messages: Array.isArray(msgs) ? msgs.length : 0,
                    memos: Array.isArray(memos) ? memos.length : 0,
                    photos: Array.isArray(photos) ? photos.length : 0,
                    milestones: Array.isArray(miles) ? miles.length : 0,
                });
            } catch (e) {
                console.error("Failed to fetch counts", e);
            }
        };
        fetchData();
    }, []);

    const handleLogout = async () => {
        await fetch('/api/admin/logout', { method: 'POST' });
        router.push('/admin');
        router.refresh();
    };

    const cards = [
        { title: '留言总数', count: counts.messages, icon: MessageCircle, color: '#FFCDD2', href: '/admin/messages' },
        { title: '备忘录', count: counts.memos, icon: StickyNote, color: '#B2EBF2', href: '/admin/memos' },
        { title: '照片', count: counts.photos, icon: ImageIcon, color: '#F0F4C3', href: '/admin/photos' },
        { title: '里程碑', count: counts.milestones, icon: Star, color: '#E1BEE7', href: '/admin/milestones' },
    ];

    return (
        <div className={styles.container}>
            <div className={styles.topBar}>
                <div>
                    <h1>欢迎回来，我的爱人 💖</h1>
                    <p>这里是你的专属管理中心。</p>
                </div>
                <button onClick={handleLogout} className={styles.logoutBtn}>
                    <LogOut size={18} />
                    退出登录
                </button>
            </div>

            <div className={styles.grid}>
                {cards.map((card, idx) => (
                    <Link href={card.href} key={idx} className={styles.card} style={{ borderBottom: `4px solid ${card.color}`, textDecoration: 'none' }}>
                        <div className={styles.header}>
                            <h3>{card.title}</h3>
                            <card.icon color={card.color} size={24} />
                        </div>
                        <div className={styles.count}>{card.count}</div>
                    </Link>
                ))}
            </div>

            <div className={styles.quickActions}>
                <h2>快捷操作</h2>
                <div className={styles.actionGrid}>
                    <Link href="/admin/questions" className={styles.actionCard}>
                        <Lock size={24} color="#F48FB1" />
                        <div>
                            <h3>安全问题</h3>
                            <p>管理验证问题</p>
                        </div>
                    </Link>
                    <Link href="/admin/manage" className={styles.actionCard}>
                        <Lock size={24} color="#42A5F5" />
                        <div>
                            <h3>账号管理</h3>
                            <p>修改密码等</p>
                        </div>
                    </Link>
                    <Link href="/admin/config" className={styles.actionCard}>
                        <Star size={24} color="#FFB74D" />
                        <div>
                            <h3>网站配置</h3>
                            <p>首页、模型、信件</p>
                        </div>
                    </Link>
                    <Link href="/admin/timers" className={styles.actionCard}>
                        <StickyNote size={24} color="#4DD0E1" />
                        <div>
                            <h3>计时器</h3>
                            <p>自定义倒计时</p>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}
