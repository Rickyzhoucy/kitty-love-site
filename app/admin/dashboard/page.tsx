"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, StickyNote, Image as ImageIcon, Star, LogOut, User, Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { messagesApi, milestonesApi, photosApi, plansApi, wishesApi } from '@/lib/api/resources';
import { authApi } from '@/lib/api/auth';

export default function DashboardOverview() {
    const [counts, setCounts] = useState({ messages: 0, plans: 0, wishes: 0, photos: 0, milestones: 0 });
    const router = useRouter();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [msgs, plans, wishes, photos, miles] = await Promise.all([
                    messagesApi.list(),
                    plansApi.list(),
                    wishesApi.list(),
                    photosApi.list(),
                    milestonesApi.list(),
                ]);

                setCounts({
                    messages: Array.isArray(msgs) ? msgs.length : 0,
                    plans: Array.isArray(plans) ? plans.length : 0,
                    wishes: Array.isArray(wishes) ? wishes.length : 0,
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
        await authApi.logout();
        router.replace('/admin');
        router.refresh();
    };

    const cards = [
        { title: '留言总数', count: counts.messages, icon: MessageCircle, color: 'var(--color-accent-soft)', href: '/admin/messages' },
        { title: '计划', count: counts.plans, icon: StickyNote, color: 'var(--color-secondary-soft)', href: '/admin/plans' },
        { title: '心愿', count: counts.wishes, icon: Heart, color: 'var(--color-accent-soft)', href: '/plan' },
        { title: '照片', count: counts.photos, icon: ImageIcon, color: 'var(--color-sunken)', href: '/admin/photos' },
        { title: '里程碑', count: counts.milestones, icon: Star, color: 'var(--color-accent-soft)', href: '/admin/milestones' },
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
                    <Link href="/admin/manage" className={styles.actionCard}>
                        <User size={24} className="text-accent" />
                        <div>
                            <h3>当前账号</h3>
                            <p>查看登录身份</p>
                        </div>
                    </Link>
                    <Link href="/admin/config" className={styles.actionCard}>
                        <Star size={24} className="text-warning" />
                        <div>
                            <h3>网站配置</h3>
                            <p>首页、模型、信件</p>
                        </div>
                    </Link>
                    <Link href="/admin/timers" className={styles.actionCard}>
                        <StickyNote size={24} className="text-secondary" />
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
