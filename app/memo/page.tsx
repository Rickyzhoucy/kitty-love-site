"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Utensils, Plane, ShoppingBag, List, Sparkles } from 'lucide-react';
import styles from './page.module.css';
import { cn } from '@/lib/utils';
import ParticleBackground from '../components/ParticleBackground';
import { notifyPetExperience } from '@/lib/petEvents';

interface Memo {
    id: string;
    category: string;
    text: string;
    completed: boolean;
    createdAt: string;
}

const CATEGORIES = [
    { id: 'todo', label: '待办事项', icon: List, color: '#ff758c' },
    { id: 'to-eat', label: '想去吃', icon: Utensils, color: '#4DD0E1' },
    { id: 'to-go', label: '想去玩', icon: Plane, color: '#BA68C8' },
    { id: 'to-buy', label: '想买的', icon: ShoppingBag, color: '#FFB74D' },
];

export default function MemoPage() {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [newMemoText, setNewMemoText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0].id);
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
            notifyPetExperience(10, 'memo_add');
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
            if (!currentStatus) {
                notifyPetExperience(20, 'memo_complete');
            }
        }
    };

    const deleteMemo = async (id: string) => {
        const res = await fetch(`/api/memos?id=${id}`, { method: 'DELETE' });
        if (res.ok) {
            setMemos(memos.filter(m => m.id !== id));
        }
    };

    const activeCatData = CATEGORIES.find(c => c.id === selectedCategory);
    const displayedMemos = memos.filter(m => m.category === selectedCategory);

    return (
        <div className={styles.container}>
            <ParticleBackground particleCount={8} types={['star', 'sparkle']} />

            <header className={styles.header}>
                <div className={styles.headerText}>
                    <h1>我们的可爱计划 <Sparkles size={24} color="#ff758c" /></h1>
                    <p>和你一起做的每一件小事，都是大事。</p>
                </div>
            </header>

            {/* Interactive Tab Navigation */}
            <div className={styles.tabContainer}>
                {CATEGORIES.map(cat => {
                    const isActive = selectedCategory === cat.id;
                    return (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(styles.tabBtn, isActive && styles.activeTab)}
                            style={{ 
                                color: isActive ? 'white' : '#666',
                            }}
                        >
                            {isActive && (
                                <motion.div 
                                    layoutId="activeTab" 
                                    className={styles.activeTabBackground}
                                    style={{ background: `linear-gradient(135deg, ${cat.color}80, ${cat.color})` }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <span className={styles.tabContent}>
                                <cat.icon size={18} /> {cat.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Main Interactive Workspace */}
            <div className={styles.workspace} style={{ borderColor: `${activeCatData?.color}40` }}>
                
                {/* Floating Input Area */}
                <form onSubmit={addMemo} className={styles.floatingForm}>
                    <input
                        type="text"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        placeholder={`添加新的 ${activeCatData?.label}...`}
                        className={styles.input}
                    />
                    <button 
                        type="submit" 
                        className={styles.addBtn}
                        style={{ background: `linear-gradient(135deg, ${activeCatData?.color}80, ${activeCatData?.color})` }}
                    >
                        <Plus size={24} />
                    </button>
                </form>

                {/* Animated List */}
                <div className={styles.list}>
                    <AnimatePresence mode="popLayout">
                        {displayedMemos.length === 0 ? (
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className={styles.emptyState}
                            >
                                {activeCatData && <activeCatData.icon size={48} color={`${activeCatData.color}40`} />}
                                <p>还没有计划哦，快来添加一个吧！</p>
                            </motion.div>
                        ) : (
                            displayedMemos.map((memo, index) => (
                                <motion.div
                                    key={memo.id}
                                    layout
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20, scale: 0.9 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={cn(styles.memoCard, memo.completed && styles.completed)}
                                >
                                    <button
                                        onClick={() => toggleComplete(memo.id, memo.completed)}
                                        className={styles.checkCircle}
                                        style={{ 
                                            borderColor: memo.completed ? '#ccc' : activeCatData?.color,
                                            background: memo.completed ? '#f0f0f0' : 'transparent'
                                        }}
                                    >
                                        {memo.completed && <Check size={16} color="#888" />}
                                    </button>
                                    <span className={styles.memoText}>{memo.text}</span>
                                    <button
                                        onClick={() => deleteMemo(memo.id)}
                                        className={styles.deleteBtn}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
