"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, Heart, Plus, Calendar } from 'lucide-react';
import styles from './page.module.css';
import KittyStickers from '../components/KittyStickers';
import ParticleBackground from '../components/ParticleBackground';
import { notifyPetExperience } from '@/lib/petEvents';

interface Milestone {
    id: string;
    date: string;
    title: string;
    description: string;
}

export default function Timeline() {
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newMilestone, setNewMilestone] = useState({ title: '', date: '', description: '' });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchMilestones();
    }, []);

    const fetchMilestones = async () => {
        try {
            const res = await fetch('/api/milestones');
            if (res.ok) {
                setMilestones(await res.json());
            }
        } catch (error) {
            console.error('Failed to fetch milestones', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMilestone.title || !newMilestone.date) {
            alert('请填写标题和日期');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/milestones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newMilestone),
            });

            if (res.ok) {
                const added = await res.json();
                // Insert in sorted order
                const updated = [...milestones, added].sort((a, b) => a.date.localeCompare(b.date));
                setMilestones(updated);
                setNewMilestone({ title: '', date: '', description: '' });
                setShowForm(false);
                // 通知宠物获得经验
                notifyPetExperience(30, 'milestone');
            }
        } catch (error) {
            console.error('Failed to add milestone', error);
            alert('添加失败，请重试');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* 动态贴纸和粒子效果 */}
            <KittyStickers count={6} />
            <ParticleBackground particleCount={10} types={['star', 'heart', 'sparkle']} />

            <header className={styles.header}>
                <img
                    src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                    alt="Hello Kitty"
                    className={styles.kittyIcon}
                />
                <div>
                    <h1><Star className={styles.icon} /> 我们的故事</h1>
                    <p>一路走来，风景是你。</p>
                </div>
            </header>

            {/* Add Button */}
            <div className={styles.addSection}>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className={styles.addBtn}
                >
                    <Plus size={18} /> {showForm ? '取消' : '记录新的故事'}
                </button>
            </div>

            {/* Add Form */}
            {showForm && (
                <motion.form
                    onSubmit={handleSubmit}
                    className={styles.addForm}
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className={styles.formGroup}>
                        <label><Calendar size={14} /> 日期 *</label>
                        <input
                            type="date"
                            value={newMilestone.date}
                            onChange={(e) => setNewMilestone({ ...newMilestone, date: e.target.value })}
                            required
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>标题 *</label>
                        <input
                            type="text"
                            value={newMilestone.title}
                            onChange={(e) => setNewMilestone({ ...newMilestone, title: e.target.value })}
                            placeholder="例如：我们在一起啦"
                            required
                        />
                    </div>
                    <div className={styles.formGroup} style={{ flexBasis: '100%' }}>
                        <label>描述</label>
                        <input
                            type="text"
                            value={newMilestone.description}
                            onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })}
                            placeholder="那天阳光很好..."
                        />
                    </div>
                    <button type="submit" disabled={submitting} className={styles.submitBtn}>
                        {submitting ? '保存中...' : <><Heart size={16} /> 添加到故事</>}
                    </button>
                </motion.form>
            )}

            {loading ? (
                <p className={styles.loading}>加载故事中...</p>
            ) : (
                <div className={styles.timeline}>
                    <div className={styles.line}></div>
                    {milestones.length === 0 ? (
                        <p className={styles.empty}>还没有记录故事，点击上方按钮添加吧...</p>
                    ) : (
                        milestones.map((item, index) => (
                            <motion.div
                                key={item.id}
                                initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: index * 0.2 }}
                                className={`${styles.item} ${index % 2 === 0 ? styles.left : styles.right}`}
                            >
                                <div className={styles.content}>
                                    <div className={styles.date}>{item.date}</div>
                                    <h3>{item.title}</h3>
                                    <p>{item.description}</p>
                                    <div className={styles.marker}>
                                        <Heart size={16} fill="white" color="white" />
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
