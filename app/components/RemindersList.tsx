"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Plus, X, Check, Trash2, Calendar, Clock } from 'lucide-react';
import styles from './RemindersList.module.css';

interface Reminder {
    id: string;
    content: string;
    dueDate: string;
    completed: boolean;
}

export default function RemindersList() {
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newReminder, setNewReminder] = useState({ content: '', dueDate: '' });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchReminders();
    }, []);

    const fetchReminders = async () => {
        try {
            const res = await fetch('/api/reminders');
            if (res.ok) {
                const data = await res.json();
                setReminders(data);
            }
        } catch (e) {
            console.error("Fetch reminders failed", e);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newReminder.content || !newReminder.dueDate) return;

        setLoading(true);
        try {
            const res = await fetch('/api/reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newReminder)
            });
            if (res.ok) {
                const added = await res.json();
                setReminders([...reminders, added].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()));
                setNewReminder({ content: '', dueDate: '' });
                setShowAdd(false);
            }
        } finally {
            setLoading(false);
        }
    };

    const toggleComplete = async (id: string, current: boolean) => {
        // Optimistic update
        setReminders(reminders.map(r => r.id === id ? { ...r, completed: !current } : r));

        try {
            await fetch('/api/reminders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, completed: !current })
            });
        } catch {
            fetchReminders(); // Revert on error
        }
    };

    const deleteReminder = async (id: string) => {
        if (!confirm('确认删除此提醒？')) return;
        setReminders(reminders.filter(r => r.id !== id));
        try {
            await fetch(`/api/reminders?id=${id}`, { method: 'DELETE' });
        } catch {
            fetchReminders();
        }
    };

    const getTimeLeft = (dateStr: string) => {
        const now = new Date();
        const due = new Date(dateStr);
        const diff = due.getTime() - now.getTime();

        if (diff < 0) return { text: '已过期', color: '#ff5252' };

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        if (days > 0) return { text: `${days}天 ${hours}小时`, color: '#4CAF50' };
        return { text: `${hours}小时`, color: '#FF9800' };
    };

    const activeReminders = reminders.filter(r => !r.completed);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h3><Bell size={18} /> 提醒事项</h3>
                <button onClick={() => setShowAdd(true)} className={styles.addBtn} title="添加提醒">
                    <Plus size={16} />
                </button>
            </div>

            <div className={styles.list}>
                <AnimatePresence>
                    {activeReminders.length === 0 ? (
                        <p className={styles.empty}>暂无待办，享受生活吧~</p>
                    ) : (
                        activeReminders.map(r => {
                            const timeLeft = getTimeLeft(r.dueDate);
                            return (
                                <motion.div
                                    key={r.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    className={styles.item}
                                >
                                    <div className={styles.content}>
                                        <div className={styles.text}>{r.content}</div>
                                        <div className={styles.time} style={{ color: timeLeft.color }}>
                                            <Clock size={12} /> {timeLeft.text}
                                        </div>
                                    </div>
                                    <div className={styles.actions}>
                                        <button onClick={() => toggleComplete(r.id, r.completed)} className={styles.checkBtn}>
                                            <Check size={14} />
                                        </button>
                                        <button onClick={() => deleteReminder(r.id)} className={styles.deleteBtn}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </AnimatePresence>
            </div>

            {/* Scale-in Modal for Adding */}
            <AnimatePresence>
                {showAdd && (
                    <motion.div
                        className={styles.addModalOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAdd(false)}
                    >
                        <motion.div
                            className={styles.addModal}
                            initial={{ scale: 0.8, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.8, y: 20 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h4>新建提醒</h4>
                            <form onSubmit={handleAdd}>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="要做什么？"
                                    value={newReminder.content}
                                    onChange={e => setNewReminder({ ...newReminder, content: e.target.value })}
                                    className={styles.input}
                                    required
                                />
                                <div className={styles.dateInputWrapper}>
                                    <Calendar size={16} color="#666" />
                                    <input
                                        type="datetime-local"
                                        value={newReminder.dueDate}
                                        onChange={e => setNewReminder({ ...newReminder, dueDate: e.target.value })}
                                        className={styles.dateInput}
                                        required
                                    />
                                </div>
                                <div className={styles.modalActions}>
                                    <button type="button" onClick={() => setShowAdd(false)} className={styles.cancelBtn}>取消</button>
                                    <button type="submit" disabled={loading} className={styles.saveBtn}>保存</button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
