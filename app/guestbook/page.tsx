"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageCircle, Heart } from 'lucide-react';
import styles from './page.module.css';
import { format } from 'date-fns';
import ParticleBackground from '../components/ParticleBackground';
import { notifyPetExperience } from '@/lib/petEvents';

interface Message {
    id: string;
    nickname: string;
    content: string;
    createdAt: string;
}

export default function Guestbook() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [nickname, setNickname] = useState('');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);

    useEffect(() => {
        fetchMessages();
    }, []);

    const fetchMessages = async () => {
        try {
            const res = await fetch('/api/messages');
            if (res.ok) {
                const data = await res.json();
                setMessages(data);
            }
        } catch (error) {
            console.error('Failed to fetch messages', error);
        } finally {
            setFetching(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nickname.trim() || !content.trim()) return;

        setLoading(true);
        try {
            const res = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname, content }),
            });

            if (res.ok) {
                const newMessage = await res.json();
                setMessages([newMessage, ...messages]);
                setContent('');
                notifyPetExperience(15, 'message');
            }
        } catch (error) {
            console.error('Failed to post message', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <ParticleBackground particleCount={10} types={['heart', 'sparkle', 'petal']} />

            <div className={styles.layout}>
                {/* Left Side - Sticky Composer */}
                <div className={styles.composerColumn}>
                    <div className={styles.stickyComposer}>
                        <header className={styles.header}>
                            <h1>
                                <MessageCircle size={28} className={styles.headerIcon} /> 
                                留言板
                            </h1>
                            <p>写下你想对我说的话，让时间记住我们的点滴。</p>
                        </header>

                        <form onSubmit={handleSubmit} className={styles.formCard}>
                            <div className={styles.inputGroup}>
                                <label>你是谁？</label>
                                <input
                                    type="text"
                                    placeholder="你的昵称"
                                    value={nickname}
                                    onChange={(e) => setNickname(e.target.value)}
                                    maxLength={20}
                                    required
                                    className={styles.input}
                                />
                            </div>
                            <div className={styles.inputGroup}>
                                <label>想对我说的话</label>
                                <textarea
                                    placeholder="在这里写下你的专属留言..."
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    maxLength={200}
                                    required
                                    className={styles.textarea}
                                />
                            </div>
                            <button type="submit" disabled={loading} className={styles.submitBtn}>
                                {loading ? '发送中...' : (
                                    <>
                                        送出真心 <Send size={18} />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Right Side - Masonry Messages */}
                <div className={styles.messagesColumn}>
                    {fetching ? (
                        <div className={styles.loadingState}>
                            <motion.div
                                animate={{ scale: [1, 1.2, 1] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                            >
                                <Heart size={40} color="#ff758c" />
                            </motion.div>
                            <p>正在读取回忆...</p>
                        </div>
                    ) : (
                        <div className={styles.masonryGrid}>
                            <AnimatePresence>
                                {messages.map((msg, index) => (
                                    <motion.div
                                        key={msg.id}
                                        layout
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        transition={{ delay: index * 0.05 }}
                                        className={styles.messageCard}
                                    >
                                        <p className={styles.messageContent}>"{msg.content}"</p>
                                        <div className={styles.cardFooter}>
                                            <div className={styles.authorInfo}>
                                                <div className={styles.avatar}>
                                                    {msg.nickname.charAt(0).toUpperCase()}
                                                </div>
                                                <span className={styles.nickname}>{msg.nickname}</span>
                                            </div>
                                            <span className={styles.date}>
                                                {format(new Date(msg.createdAt), 'MM/dd')}
                                            </span>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                            {messages.length === 0 && (
                                <div className={styles.emptyState}>
                                    <p>还没有留言哦，快来抢沙发！</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
