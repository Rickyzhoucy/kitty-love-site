"use client";

import { useState, useEffect } from 'react';
import { Trash2, Plus, Clock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';
import { timersApi, type EventTimer } from '@/lib/api/resources';
import { useToast } from '@/app/components/ui/Toast';

export default function TimersManagement() {
    const [timers, setTimers] = useState<EventTimer[]>([]);
    const [newTimer, setNewTimer] = useState({ title: '', date: '', type: 'countup', description: '' });
    const [adding, setAdding] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        timersApi.list().then(setTimers).catch(() => {
            toast('加载计时器失败', 'error');
        });
    }, [toast]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setAdding(true);
        try {
            const added = await timersApi.create(newTimer);
            setTimers([...timers, added]);
            setNewTimer({ title: '', date: '', type: 'countup', description: '' });
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await timersApi.remove(id);
            setTimers(timers.filter(t => t.id !== id));
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
                            onChange={e => setNewTimer({
                                ...newTimer,
                                type: e.target.value as 'countup' | 'countdown',
                            })}
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
                            {deletingId === t.id ? (
                                <div className={styles.confirmDelete}>
                                    <button onClick={() => handleDelete(t.id)} className={styles.confirmBtn}>确定</button>
                                    <button onClick={() => setDeletingId(null)} className={styles.cancelBtn}>取消</button>
                                </div>
                            ) : (
                                <button onClick={() => setDeletingId(t.id)} className={styles.deleteBtn}>
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
