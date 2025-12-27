"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Star, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';

interface Milestone {
    id: string;
    title: string;
    date: string;
    description: string;
    createdAt: string;
}

export default function MilestonesManagement() {
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        fetchMilestones();
    }, []);

    const fetchMilestones = async () => {
        try {
            const res = await fetch('/api/milestones');
            if (res.ok) {
                setMilestones(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch milestones', err);
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/milestones?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMilestones(milestones.filter(m => m.id !== id));
                setDeletingId(null);
            } else {
                alert('删除失败');
            }
        } catch {
            alert('删除出错');
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <Star size={28} color="#E1BEE7" />
                    <div>
                        <h1>里程碑管理</h1>
                        <p>见证每一个重要时刻</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2>已有里程碑 ({milestones.length})</h2>
                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : milestones.length === 0 ? (
                    <p className={styles.empty}>暂无里程碑</p>
                ) : (
                    <div className={styles.list}>
                        <AnimatePresence>
                            {milestones.map((m) => (
                                <motion.div
                                    key={m.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className={styles.questionItem}
                                >
                                    <div className={styles.questionContent}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{
                                                background: '#F3E5F5', color: '#8E24AA', fontWeight: 'bold',
                                                padding: '4px 8px', borderRadius: '6px'
                                            }}>
                                                {m.date}
                                            </span>
                                            <span style={{ fontWeight: 600, fontSize: '1.1rem', color: '#333' }}>{m.title}</span>
                                        </div>
                                        <p style={{ margin: '5px 0 0', color: '#666', fontSize: '0.95rem' }}>{m.description}</p>
                                    </div>
                                    <div className={styles.actions}>
                                        {deletingId === m.id ? (
                                            <div className={styles.confirmDelete}>
                                                <span>确定删除?</span>
                                                <button onClick={() => confirmDelete(m.id)} className={styles.confirmBtn}>确定</button>
                                                <button onClick={() => setDeletingId(null)} className={styles.cancelBtn}>取消</button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setDeletingId(m.id)} className={styles.deleteBtn}>
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </section>
        </div>
    );
}
