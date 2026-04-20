"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Heart, Plus, Calendar, Sparkles, X, ChevronRight } from 'lucide-react';
import styles from './page.module.css';
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
    const [showModal, setShowModal] = useState(false);
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
                const updated = [...milestones, added].sort((a, b) => a.date.localeCompare(b.date));
                setMilestones(updated);
                setNewMilestone({ title: '', date: '', description: '' });
                setShowModal(false);
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
            <ParticleBackground particleCount={10} types={['star', 'heart', 'sparkle']} />

            <header className={styles.header}>
                <div className={styles.headerContent}>
                    <div className={styles.titleWrapper}>
                        <Star className={styles.headerIcon} size={36} />
                        <h1>我们的故事</h1>
                        <Sparkles className={styles.headerSparkle} size={24} />
                    </div>
                    <p>把时间酿成酒，把沿途的风景写成诗。</p>
                </div>
                
                <button
                    onClick={() => setShowModal(true)}
                    className={styles.addRecordBtn}
                >
                    <Plus size={20} /> 记录新的一页
                </button>
            </header>

            {loading ? (
                <div className={styles.loadingState}>
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <Heart size={40} color="#ff758c" />
                    </motion.div>
                    <p>正在穿梭时光机...</p>
                </div>
            ) : (
                <div className={styles.timelineWrapper}>
                    <div className={styles.glowingSpine}>
                        <motion.div 
                            className={styles.spineProgress}
                            initial={{ height: 0 }}
                            animate={{ height: "100%" }}
                            transition={{ duration: 2, ease: "easeOut" }}
                        />
                    </div>

                    {milestones.length === 0 ? (
                        <div className={styles.emptyState}>
                            <p>时间的长河还是一片空白，快来写下第一笔吧！</p>
                        </div>
                    ) : (
                        <div className={styles.timelineList}>
                            {milestones.map((item, index) => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50, y: 20 }}
                                    whileInView={{ opacity: 1, x: 0, y: 0 }}
                                    viewport={{ once: true, margin: "-100px" }}
                                    transition={{ duration: 0.6, delay: index * 0.1, type: 'spring', bounce: 0.4 }}
                                    className={`${styles.timelineNode} ${index % 2 === 0 ? styles.nodeLeft : styles.nodeRight}`}
                                >
                                    <div className={styles.nodeMarker}>
                                        <div className={styles.markerInner}>
                                            <Heart size={14} fill="white" color="white" />
                                        </div>
                                    </div>
                                    
                                    <div className={styles.nodeCard}>
                                        <div className={styles.cardHeader}>
                                            <span className={styles.dateBadge}>
                                                <Calendar size={14} /> {item.date}
                                            </span>
                                        </div>
                                        <h3 className={styles.cardTitle}>{item.title}</h3>
                                        {item.description && (
                                            <p className={styles.cardDesc}>{item.description}</p>
                                        )}
                                        <div className={styles.cardFooter}>
                                            <ChevronRight size={18} className={styles.hoverArrow} />
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Premium Add Modal */}
            <AnimatePresence>
                {showModal && (
                    <div className={styles.modalOverlay}>
                        <motion.div 
                            className={styles.modalBackdrop}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => !submitting && setShowModal(false)}
                        />
                        <motion.div 
                            className={styles.modalContent}
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        >
                            <button className={styles.closeBtn} onClick={() => !submitting && setShowModal(false)}>
                                <X size={24} />
                            </button>
                            <h2>翻开新的一页</h2>
                            <p className={styles.modalSubtitle}>将这一刻的感动永远刻印在时间轴上。</p>
                            
                            <form onSubmit={handleSubmit} className={styles.modalForm}>
                                <div className={styles.formGroup}>
                                    <label>这是哪一天发生的故事？ *</label>
                                    <input
                                        type="date"
                                        value={newMilestone.date}
                                        onChange={(e) => setNewMilestone({ ...newMilestone, date: e.target.value })}
                                        required
                                        className={styles.input}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <label>给这个故事起个名字 *</label>
                                    <input
                                        type="text"
                                        value={newMilestone.title}
                                        onChange={(e) => setNewMilestone({ ...newMilestone, title: e.target.value })}
                                        placeholder="例如：第一次看雪"
                                        required
                                        className={styles.input}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <label>详细写下那天的细节吧</label>
                                    <textarea
                                        value={newMilestone.description}
                                        onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })}
                                        placeholder="那天阳光很好，我们走在街上..."
                                        className={styles.textarea}
                                    />
                                </div>
                                <button type="submit" disabled={submitting} className={styles.submitBtn}>
                                    {submitting ? '时空跃迁中...' : '✨ 刻印这段记忆'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
