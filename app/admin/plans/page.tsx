"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, StickyNote, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';
import { plansApi, wishesApi, type Plan, type Wish } from '@/lib/api/resources';
import { useToast } from '@/app/components/ui/Toast';

/** 后台：计划与心愿的只读清单 + 删除。两者放一页，它们本来就是一次拆分的两半。 */
export default function PlansManagement() {
    const [memos, setMemos] = useState<(Plan | Wish)[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        fetchMemos();
    }, []);

    const fetchMemos = async () => {
        try {
            const [plans, wishes] = await Promise.all([plansApi.list(), wishesApi.list()]);
            setMemos([...plans, ...wishes]);
        } catch (err) {
            console.error('Failed to fetch plans/wishes', err);
        } finally {
            setLoading(false);
        }
    };

    const isWish = (item: Plan | Wish): item is Wish => 'category' in item;

    const confirmDelete = async (id: string) => {
        const target = memos.find(item => item.id === id);
        if (!target) return;
        try {
            await (isWish(target) ? wishesApi : plansApi).remove(id);
            setMemos(memos.filter(m => m.id !== id));
            setDeletingId(null);
        } catch {
            toast('删除失败', 'error');
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <StickyNote size={28} color="#4DD0E1" />
                    <div>
                        <h1>计划与心愿</h1>
                        <p>查看并删除所有计划与心愿</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2>共 {memos.length} 条</h2>
                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : memos.length === 0 ? (
                    <p className={styles.empty}>还没有内容</p>
                ) : (
                    <div className={styles.list}>
                        <AnimatePresence>
                            {memos.map((m) => (
                                <motion.div
                                    key={m.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className={styles.questionItem}
                                >
                                    <div className={styles.questionContent}>
                                        <span style={{
                                            background: '#E0F7FA', color: '#006064',
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', marginRight: '8px'
                                        }}>
                                            {isWish(m) ? m.category : '计划'}
                                        </span>
                                        <p style={{ display: 'inline', textDecoration: m.completedAt ? 'line-through' : 'none', color: m.completedAt ? '#999' : '#333' }}>
                                            {m.title}
                                        </p>
                                        <br />
                                        <small>{new Date(m.createdAt).toLocaleString('zh-CN')}</small>
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
