"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Utensils, Plane, ShoppingBag, List } from 'lucide-react';
import styles from './page.module.css';
import { cn } from '@/lib/utils';
import KittyStickers from '../components/KittyStickers';
import ParticleBackground from '../components/ParticleBackground';

interface Memo {
    id: string;
    category: string;
    text: string;
    completed: boolean;
    createdAt: string;
}

const CATEGORIES = [
    { id: 'to-eat', label: '想去吃', icon: Utensils, color: '#FFCDD2' },
    { id: 'to-go', label: '想去玩', icon: Plane, color: '#B2EBF2' },
    { id: 'to-buy', label: '想买的', icon: ShoppingBag, color: '#F8BBD0' },
    { id: 'todo', label: '待办事项', icon: List, color: '#E1BEE7' },
];

export default function MemoPage() {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [newMemoText, setNewMemoText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[3].id);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMemos();
    }, []);

    const fetchMemos = async () => {
        try {
            const res = await fetch('/api/memos');
            if (res.ok) setMemos(await res.json());
        } catch (error) {
            console.error('Failed to fetch', error);
        } finally {
            setLoading(false);
        }
    };

    const addMemo = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMemoText.trim()) return;

        const res = await fetch('/api/memos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: selectedCategory, text: newMemoText }),
        });

        if (res.ok) {
            const newMemo = await res.json();
            setMemos([newMemo, ...memos]);
            setNewMemoText('');
        }
    };

    const toggleComplete = async (id: string, currentStatus: boolean) => {
        const res = await fetch('/api/memos', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, completed: !currentStatus }),
        });

        if (res.ok) {
            setMemos(memos.map(m => m.id === id ? { ...m, completed: !currentStatus } : m));
        }
    };

    const deleteMemo = async (id: string) => {
        const res = await fetch(`/api/memos?id=${id}`, { method: 'DELETE' });
        if (res.ok) {
            setMemos(memos.filter(m => m.id !== id));
        }
    };

    return (
        <div className={styles.container}>
            {/* 动态贴纸和粒子效果 */}
            <KittyStickers count={6} />
            <ParticleBackground particleCount={8} types={['star', 'sparkle']} />

            <header className={styles.header}>
                <img
                    src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                    alt="Hello Kitty"
                    className={styles.kittyIcon}
                />
                <div>
                    <h1>我们的可爱计划 📝</h1>
                    <p>和你一起做的每一件小事，都是大事。</p>
                </div>
            </header>

            <div className={styles.inputSection}>
                <div className={styles.categorySelector}>
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(styles.categoryBtn, selectedCategory === cat.id && styles.activeCat)}
                            style={{ backgroundColor: selectedCategory === cat.id ? cat.color : 'transparent' }}
                        >
                            <cat.icon size={18} /> {cat.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={addMemo} className={styles.form}>
                    <input
                        type="text"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        placeholder={`添加到 ${CATEGORIES.find(c => c.id === selectedCategory)?.label}...`}
                        className={styles.input}
                    />
                    <button type="submit" className={styles.addBtn}>
                        <Plus size={20} />
                    </button>
                </form>
            </div>

            <div className={styles.listsContainer}>
                {CATEGORIES.map(cat => {
                    const catMemos = memos.filter(m => m.category === cat.id);
                    return (
                        <div key={cat.id} className={styles.column}>
                            <h3 className={styles.columnTitle} style={{ borderBottomColor: cat.color }}>
                                <cat.icon size={20} /> {cat.label}
                                <span className={styles.bowCorner}>🎀</span>
                            </h3>
                            <div className={styles.list}>
                                <AnimatePresence>
                                    {catMemos.length === 0 ? (
                                        <p className={styles.emptyText}>这里还是空的哦...</p>
                                    ) : (
                                        catMemos.map(memo => (
                                            <motion.div
                                                key={memo.id}
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.8 }}
                                                className={cn(styles.memoItem, memo.completed && styles.completed)}
                                            >
                                                <button
                                                    onClick={() => toggleComplete(memo.id, memo.completed)}
                                                    className={styles.checkBox}
                                                >
                                                    {memo.completed && <Check size={14} />}
                                                </button>
                                                <span className={styles.memoText}>{memo.text}</span>
                                                <button
                                                    onClick={() => deleteMemo(memo.id)}
                                                    className={styles.deleteBtn}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </motion.div>
                                        ))
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
