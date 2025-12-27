"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, StickyNote, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';

interface Memo {
    id: string;
    category: string;
    text: string;
    completed: boolean;
    createdAt: string;
}

export default function MemosManagement() {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        fetchMemos();
    }, []);

    const fetchMemos = async () => {
        try {
            const res = await fetch('/api/memos');
            if (res.ok) {
                setMemos(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch memos', err);
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/memos?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMemos(memos.filter(m => m.id !== id));
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
                    <StickyNote size={28} color="#4DD0E1" />
                    <div>
                        <h1>备忘录管理</h1>
                        <p>查看并管理所有备忘</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2>已有备忘 ({memos.length})</h2>
                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : memos.length === 0 ? (
                    <p className={styles.empty}>暂无备忘</p>
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
                                            {m.category}
                                        </span>
                                        <p style={{ display: 'inline', textDecoration: m.completed ? 'line-through' : 'none', color: m.completed ? '#999' : '#333' }}>
                                            {m.text}
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
