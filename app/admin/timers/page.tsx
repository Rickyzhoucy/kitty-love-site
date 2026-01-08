"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, Clock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';

interface Timer {
    id: string;
    title: string;
    date: string;
    type: 'countdown' | 'countup';
    description?: string;
}

export default function TimersManagement() {
    const [timers, setTimers] = useState<Timer[]>([]);
    const [loading, setLoading] = useState(true);
    const [newTimer, setNewTimer] = useState({ title: '', date: '', type: 'countup', description: '' });
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        fetchTimers();
    }, []);

    const fetchTimers = async () => {
        try {
            const res = await fetch('/api/timers');
            if (res.ok) setTimers(await res.json());
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setAdding(true);
        try {
            const res = await fetch('/api/timers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTimer)
            });
            if (res.ok) {
                const added = await res.json();
                setTimers([...timers, added]);
                setNewTimer({ title: '', date: '', type: 'countup', description: '' });
            } else {
                alert('添加失败');
            }
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('确定删除?')) return;
        try {
            const res = await fetch(`/api/timers?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setTimers(timers.filter(t => t.id !== id));
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
                    <Clock size={28} color="#4DD0E1" />
                    <div>
                        <h1>自定义计时器</h1>
                        <p>添加倒计时或纪念日</p>
                    </div>
                </div>
            </header>

            <section className={styles.formSection}>
                <h2><Plus size={20} /> 添加计时器</h2>
                <form onSubmit={handleAdd} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <label>标题</label>
                        <input required type="text" value={newTimer.title} onChange={e => setNewTimer({ ...newTimer, title: e.target.value })} placeholder="例如：她的生日 / 考研倒计时" />
                    </div>
                    <div className={styles.inputGroup}>
                        <label>日期时间</label>
                        <input required type="datetime-local" value={newTimer.date} onChange={e => setNewTimer({ ...newTimer, date: e.target.value })} />
                    </div>
                    <div className={styles.inputGroup}>
                        <label>类型</label>
                        <select
                            value={newTimer.type}
                            onChange={e => setNewTimer({ ...newTimer, type: e.target.value as any })}
                            style={{ padding: '0.8rem', borderRadius: '10px', border: '2px solid #E0E0E0' }}
                        >
                            <option value="countup">正计时 (已过去多久)</option>
                            <option value="countdown">倒计时 (还有多久)</option>
                        </select>
                    </div>
                    <button type="submit" disabled={adding} className={styles.addBtn}>
                        {adding ? '添加中...' : '添加'}
                    </button>
                </form>
            </section>

            <section className={styles.listSection}>
                <h2>已有计时器 ({timers.length})</h2>
                <div className={styles.list}>
                    {timers.map(t => (
                        <div key={t.id} className={styles.questionItem}>
                            <div className={styles.questionContent}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{
                                        background: t.type === 'countdown' ? '#FFEBEE' : '#E0F2F1',
                                        color: t.type === 'countdown' ? '#C62828' : '#00695C',
                                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem'
                                    }}>
                                        {t.type === 'countdown' ? '倒计时' : '正计时'}
                                    </span>
                                    <strong>{t.title}</strong>
                                </div>
                                <p style={{ color: '#666', margin: '5px 0' }}>{t.date}</p>
                            </div>
                            <button onClick={() => handleDelete(t.id)} className={styles.deleteBtn}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
