"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageCircle } from 'lucide-react';
import styles from './page.module.css';
import { format } from 'date-fns';
import KittyStickers from '../components/KittyStickers';
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
                // 通知宠物获得经验
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
            {/* 动态贴纸和粒子效果 */}
            <KittyStickers count={6} />
            <ParticleBackground particleCount={10} types={['heart', 'sparkle', 'petal']} />

            <header className={styles.header}>
                <img
                    src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                    alt="Hello Kitty"
                    className={styles.kittyIcon}
                />
                <div>
                    <h1><MessageCircle className={styles.icon} /> 留言板</h1>
                    <p>写下你想对我说的话吧！</p>
                </div>
            </header>

            <section className={styles.formSection}>
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.inputGroup}>
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
                        <textarea
                            placeholder="在这里写下你的留言..."
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            maxLength={200}
                            required
                            className={styles.textarea}
                        />
                    </div>
                    <button type="submit" disabled={loading} className={styles.button}>
                        {loading ? '发送中...' : (
                            <>
                                发送 <Send size={16} />
                            </>
                        )}
                    </button>
                </form>
            </section>

            <section className={styles.messagesSection}>
                {fetching ? (
                    <p className={styles.loading}>加载留言中...</p>
                ) : (
                    <div className={styles.grid}>
                        <AnimatePresence>
                            {messages.map((msg, index) => (
                                <motion.div
                                    key={msg.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.3 }}
                                    className={styles.card}
                                    style={{
                                        rotate: index % 2 === 0 ? '2deg' : '-2deg',
                                    }}
                                >
                                    <p className={styles.messageContent}>{msg.content}</p>
                                    <div className={styles.cardFooter}>
                                        <span className={styles.nickname}>- {msg.nickname}</span>
                                        <span className={styles.date}>
                                            {format(new Date(msg.createdAt), 'MMM d, yyyy')}
                                        </span>
                                    </div>
                                    <div className={styles.pin}>🎀</div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        {messages.length === 0 && (
                            <p className={styles.empty}>还没有留言哦，快来抢沙发！</p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
