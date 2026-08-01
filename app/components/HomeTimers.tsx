"use client";

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import Countdown from './Countdown';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Input } from './ui/Input';
import EmptyState from './ui/EmptyState';
import { useToast } from './ui/Toast';
import { timersApi, type EventTimer } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

/** 首页计时器区块：文档流内，横向排列计时器卡片 */
export default function HomeTimers() {
    const [timers, setTimers] = useState<EventTimer[]>([]);
    const [showAddTimer, setShowAddTimer] = useState(false);
    const [addingTimer, setAddingTimer] = useState(false);
    const [newTimer, setNewTimer] = useState({ title: '', date: '', type: 'countup' as 'countup' | 'countdown' });
    /** 正在编辑的那条；null 表示这次是「新建」。同一个表单两用。 */
    const [editing, setEditing] = useState<EventTimer | null>(null);
    const { toast } = useToast();

    const loadTimers = useCallback(async () => {
        try {
            const data = await timersApi.list();
            if (Array.isArray(data)) setTimers(data);
        } catch (error) {
            console.error('Failed to fetch timers', error);
        }
    }, []);

    useEffect(() => {
        void loadTimers();
    }, [loadTimers]);
    useResourceEvents(['timers'], () => void loadTimers());

    /** 点「添加」：空表单。 */
    const openCreate = () => {
        setEditing(null);
        setNewTimer({ title: '', date: '', type: 'countup' });
        setShowAddTimer(true);
    };

    /** 点卡片上的铅笔：把现有值填进同一个表单。 */
    const openEdit = (timer: EventTimer) => {
        setEditing(timer);
        setNewTimer({
            title: timer.title,
            // datetime-local 只认 `YYYY-MM-DDTHH:mm`。老数据里可能是纯日期，
            // 补上零点，否则输入框会因为格式不合直接显示成空的。
            date: /^\d{4}-\d{2}-\d{2}$/.test(timer.date) ? `${timer.date}T00:00` : timer.date.slice(0, 16),
            type: timer.type as 'countup' | 'countdown',
        });
        setShowAddTimer(true);
    };

    const handleSubmitTimer = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddingTimer(true);
        try {
            if (editing) {
                const saved = await timersApi.update(editing.id, newTimer);
                setTimers(timers.map(t => (t.id === editing.id ? saved : t)));
                toast('已更新');
            } else {
                const added = await timersApi.create(newTimer);
                setTimers([...timers, added]);
                toast('纪念日添加成功 🎉');
            }
            setNewTimer({ title: '', date: '', type: 'countup' });
            setEditing(null);
            setShowAddTimer(false);
        } catch (err) {
            toast(err instanceof Error ? err.message : (editing ? '保存失败' : '添加失败'), 'error');
        } finally {
            setAddingTimer(false);
        }
    };

    const handleDeleteTimer = async (id: string) => {
        const previousTimers = [...timers];
        setTimers(timers.filter(t => t.id !== id));
        try {
            await timersApi.remove(id);
            toast('已删除');
        } catch (err) {
            setTimers(previousTimers);
            toast(err instanceof Error ? err.message : '删除失败，请重试', 'error');
        }
    };

    return (
        <section aria-label="纪念日计时">
            <div className="flex items-end justify-between mb-5 px-1">
                <h2 className="flex items-baseline gap-3 m-0">
                    <span aria-hidden className="font-display text-5xl font-semibold leading-none text-stroke-accent select-none">
                        01
                    </span>
                    <span className="font-display text-2xl font-semibold tracking-wide text-ink">纪念日</span>
                </h2>
                <Button size="sm" variant="secondary" onClick={openCreate} aria-label="添加新计时器">
                    <Plus size={16} />
                    添加
                </Button>
            </div>

            {timers.length === 0 ? (
                <EmptyState icon="⏳" title="还没有纪念日" hint="添加一个值得纪念的日子吧" />
            ) : (
                /* 横向滑动卡带：snap 对齐，突破网格宽度 */
                <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-3 snap-x snap-mandatory">
                    <AnimatePresence>
                        {timers.map(t => (
                            <Countdown
                                key={t.id}
                                startDate={t.date}
                                title={t.title}
                                type={t.type as 'countup' | 'countdown'}
                                onEdit={() => openEdit(t)}
                                onDelete={() => handleDeleteTimer(t.id)}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}

            <Modal
                open={showAddTimer}
                onOpenChange={open => {
                    setShowAddTimer(open);
                    if (!open) setEditing(null);
                }}
                title={editing ? '编辑纪念日' : '添加新纪念日'}
            >
                <form onSubmit={handleSubmitTimer} className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="timer-title" className="block mb-1.5 text-sm text-ink-muted">标题</label>
                        <Input
                            id="timer-title"
                            required
                            type="text"
                            value={newTimer.title}
                            onChange={e => setNewTimer({ ...newTimer, title: e.target.value })}
                            placeholder="例如：第一次看电影"
                        />
                    </div>
                    <div>
                        <label htmlFor="timer-date" className="block mb-1.5 text-sm text-ink-muted">日期</label>
                        <Input
                            id="timer-date"
                            required
                            type="datetime-local"
                            value={newTimer.date}
                            onChange={e => setNewTimer({ ...newTimer, date: e.target.value })}
                        />
                    </div>
                    <div>
                        <span className="block mb-1.5 text-sm text-ink-muted">类型</span>
                        <div className="flex gap-2">
                            {(['countup', 'countdown'] as const).map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setNewTimer({ ...newTimer, type })}
                                    className={cn(
                                        'flex-1 h-10 rounded-full border transition-all cursor-pointer',
                                        newTimer.type === type
                                            ? 'border-accent bg-accent text-on-accent font-medium shadow-soft'
                                            : 'border-sunken bg-surface text-ink-muted hover:border-accent/40'
                                    )}
                                >
                                    {type === 'countup' ? '正计时' : '倒计时'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <Button type="submit" disabled={addingTimer} className="w-full">
                        {addingTimer
                            ? (editing ? '保存中...' : '添加中...')
                            : (editing ? '保存' : '确认添加')}
                    </Button>
                </form>
            </Modal>
        </section>
    );
}
