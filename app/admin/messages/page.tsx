"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, MessageCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css'; // Reuse existing styles

interface Message {
    id: string;
    nickname: string;
    content: string;
    createdAt: string;
}

export default function MessagesManagement() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        fetchMessages();
    }, []);

    const fetchMessages = async () => {
        try {
            const res = await fetch('/api/messages');
            if (res.ok) {
                setMessages(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch messages', err);
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/messages?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessages(messages.filter(m => m.id !== id));
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
                    <MessageCircle size={28} color="#F48FB1" />
                    <div>
                        <h1>留言板管理</h1>
                        <p>查看并管理所有留言</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2>已有留言 ({messages.length})</h2>
                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : messages.length === 0 ? (
                    <p className={styles.empty}>暂无留言</p>
                ) : (
                    <div className={styles.list}>
                        <AnimatePresence>
                            {messages.map((m) => (
                                <motion.div
                                    key={m.id}
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className={styles.questionItem}
                                >
                                    <div className={styles.questionContent}>
                                        <p style={{ fontWeight: 'bold', color: '#E91E63' }}>{m.nickname}</p>
                                        <p>{m.content}</p>
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
