"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, Trash2, Clock } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Input } from './ui/Input';
import EmptyState from './ui/EmptyState';
import { useToast } from './ui/Toast';
import { remindersApi, type Reminder } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

function getTimeLeft(dateStr: string): { text: string; tone: 'danger' | 'warning' | 'success' } {
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff < 0) return { text: '已过期', tone: 'danger' };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return { text: `${days}天 ${hours}小时 ${minutes}分`, tone: 'success' };
    if (hours > 0) return { text: `${hours}小时 ${minutes}分`, tone: 'warning' };
    return { text: `${minutes}分`, tone: 'danger' };
}

const toneStyles = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
};

/** 首页提醒区块：文档流内卡片 */
export default function RemindersList() {
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newReminder, setNewReminder] = useState({ content: '', dueDate: '' });
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    const loadReminders = useCallback(async () => {
        try {
            setReminders(await remindersApi.list());
        } catch (error) {
            console.error('Fetch reminders failed', error);
        }
    }, []);

    useEffect(() => {
        void loadReminders();
    }, [loadReminders]);
    useResourceEvents(['reminders'], () => void loadReminders());

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newReminder.content || !newReminder.dueDate) return;

        setLoading(true);
        try {
            const added = await remindersApi.create(newReminder);
            setReminders(prev =>
                [...prev, added].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
            );
            setNewReminder({ content: '', dueDate: '' });
            setShowAdd(false);
            toast('提醒已创建 🔔');
        } catch (err) {
            toast(err instanceof Error ? err.message : '创建失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleComplete = async (id: string, current: boolean) => {
        setReminders(reminders.map(r => (r.id === id ? { ...r, completed: !current } : r)));
        try {
            await remindersApi.update(id, !current);
        } catch {
            const fresh = await remindersApi.list().catch(() => null);
            if (fresh) setReminders(fresh);
            toast('操作失败，请重试', 'error');
        }
    };

    const deleteReminder = async (id: string) => {
        const previous = [...reminders];
        setReminders(reminders.filter(r => r.id !== id));
        try {
            await remindersApi.remove(id);
            toast('已删除');
        } catch {
            setReminders(previous);
            toast('删除失败，请重试', 'error');
        }
    };

    const activeReminders = reminders.filter(r => !r.completed);

    return (
        <section aria-label="提醒事项" className="h-full">
            <div className="flex items-end justify-between mb-5 px-1">
                <h2 className="flex items-baseline gap-3 m-0">
                    <span aria-hidden className="font-display text-5xl font-semibold leading-none text-stroke-accent select-none">
                        02
                    </span>
                    <span className="font-display text-2xl font-semibold tracking-wide text-ink">提醒事项</span>
                </h2>
                <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)} aria-label="添加提醒">
                    <Plus size={16} />
                    添加
                </Button>
            </div>

            {activeReminders.length === 0 ? (
                <EmptyState icon="🌿" title="暂无待办" hint="享受生活吧~" />
            ) : (
                /* 编辑式行列表：细分隔线 + 大字内容 + 时间胶囊 */
                <div className="flex flex-col">
                    <AnimatePresence>
                        {activeReminders.map(r => {
                            const timeLeft = getTimeLeft(r.dueDate);
                            const expired = timeLeft.text === '已过期';
                            return (
                                <motion.div
                                    key={r.id}
                                    layout
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="group flex items-center justify-between gap-3 border-b border-sunken py-4 first:border-t"
                                >
                                    <div className="min-w-0">
                                        <div className={cn('font-display text-lg font-semibold text-ink truncate', expired && 'line-through text-ink-muted')}>
                                            {r.content}
                                        </div>
                                        <div className={cn('mt-1 inline-flex items-center gap-1.5 rounded-full bg-sunken/70 px-2.5 py-0.5 text-xs', toneStyles[timeLeft.tone])}>
                                            <Clock size={12} />
                                            {timeLeft.text}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => toggleComplete(r.id, r.completed)}
                                            aria-label={`完成提醒 ${r.content}`}
                                            className="flex h-8 w-8 items-center justify-center rounded-full text-success hover:bg-success/10 transition-colors cursor-pointer"
                                        >
                                            <Check size={16} />
                                        </button>
                                        {expired && (
                                            <button
                                                onClick={() => deleteReminder(r.id)}
                                                aria-label={`删除提醒 ${r.content}`}
                                                className="flex h-8 w-8 items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            )}

            <Modal open={showAdd} onOpenChange={setShowAdd} title="新建提醒">
                <form onSubmit={handleAdd} className="flex flex-col gap-4">
                    <Input
                        autoFocus
                        type="text"
                        placeholder="要做什么？"
                        aria-label="提醒内容"
                        value={newReminder.content}
                        onChange={e => setNewReminder({ ...newReminder, content: e.target.value })}
                        required
                    />
                    <Input
                        type="datetime-local"
                        aria-label="提醒时间"
                        value={newReminder.dueDate}
                        onChange={e => setNewReminder({ ...newReminder, dueDate: e.target.value })}
                        required
                        onClick={e => e.stopPropagation()}
                        onTouchEnd={e => e.stopPropagation()}
                    />
                    <div className="flex gap-2">
                        <Button variant="ghost" className="flex-1" onClick={() => setShowAdd(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={loading} className="flex-1">
                            {loading ? '保存中...' : '保存'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </section>
    );
}
