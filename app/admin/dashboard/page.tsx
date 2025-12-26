"use client";

import { useEffect, useState } from 'react';
import { MessageCircle, StickyNote, Image as ImageIcon, Star } from 'lucide-react';
import styles from './page.module.css';

export default function DashboardOverview() {
    const [counts, setCounts] = useState({ messages: 0, memos: 0, photos: 0, milestones: 0 });

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

    const cards = [
        { title: '留言总数', count: counts.messages, icon: MessageCircle, color: '#FFCDD2' },
        { title: '备忘录', count: counts.memos, icon: StickyNote, color: '#B2EBF2' },
        { title: '照片', count: counts.photos, icon: ImageIcon, color: '#F0F4C3' },
        { title: '里程碑', count: counts.milestones, icon: Star, color: '#E1BEE7' },
    ];

    return (
        <div className={styles.container}>
            <h1>欢迎回来，我的爱人 💖</h1>
            <p>这里是你的专属管理中心。</p>

            <div className={styles.grid}>
                {cards.map((card, idx) => (
                    <div key={idx} className={styles.card} style={{ borderBottom: `4px solid ${card.color}` }}>
                        <div className={styles.header}>
                            <h3>{card.title}</h3>
                            <card.icon color={card.color} size={24} />
                        </div>
                        <div className={styles.count}>{card.count}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
