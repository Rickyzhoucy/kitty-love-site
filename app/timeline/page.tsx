"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, Plus, Calendar } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { milestonesApi, type Milestone } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

export default function Timeline() {
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newMilestone, setNewMilestone] = useState({ title: '', date: '', description: '' });
    const [submitting, setSubmitting] = useState(false);
    const { toast } = useToast();

    const loadMilestones = useCallback(async () => {
        try {
            const data = await milestonesApi.list();
            setMilestones([...data].sort((a, b) => a.date.localeCompare(b.date)));
        } catch (error) {
            console.error('Failed to fetch milestones', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMilestones();
    }, [loadMilestones]);
    useResourceEvents(['milestones'], () => void loadMilestones());

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMilestone.title || !newMilestone.date) {
            toast('请填写标题和日期', 'error');
            return;
        }

        setSubmitting(true);
        try {
            const added = await milestonesApi.create(newMilestone);
            setMilestones(prev => [...prev, added].sort((a, b) => a.date.localeCompare(b.date)));
            setNewMilestone({ title: '', date: '', description: '' });
            setShowForm(false);
            toast('故事已记录 ⭐');
        } catch (error) {
            toast(error instanceof Error ? error.message : '添加失败，请重试', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-6">
            {/* 巨型排版页头 */}
            <header className="mb-10 pt-2 animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-accent m-0">Our Story</p>
                <h1 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide m-0">
                    <span className="text-ink">我们的</span>
                    <span className="text-stroke-accent">故事</span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-ink-muted mb-0">一路走来，风景是你</p>
            </header>

            <div className="mb-5 text-center">
                <Button onClick={() => setShowForm(!showForm)}>
                    <Plus size={16} />
                    {showForm ? '取消' : '记录新的故事'}
                </Button>
            </div>

            {showForm && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-8 overflow-hidden"
                >
                    <Card className="p-6 md:p-8">
                        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                            {/* 标题轴：大衬线标题输入 */}
                            <input
                                id="ms-title"
                                type="text"
                                value={newMilestone.title}
                                onChange={(e) => setNewMilestone({ ...newMilestone, title: e.target.value })}
                                placeholder="给这一天起个名字"
                                aria-label="标题"
                                required
                                className="w-full border-0 border-b-2 border-sunken bg-transparent px-0 pb-3 font-display text-2xl md:text-3xl font-semibold tracking-wide text-ink placeholder:text-ink-muted/50 outline-none transition-colors focus:border-accent"
                            />
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="min-w-[170px]">
                                    <label htmlFor="ms-date" className="mb-1.5 flex items-center gap-1 text-sm text-ink-muted">
                                        <Calendar size={14} /> 日期 *
                                    </label>
                                    <Input
                                        id="ms-date"
                                        type="date"
                                        value={newMilestone.date}
                                        onChange={(e) => setNewMilestone({ ...newMilestone, date: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="flex-1 min-w-[220px]">
                                    <label htmlFor="ms-desc" className="block mb-1.5 text-sm text-ink-muted">描述</label>
                                    <Textarea
                                        id="ms-desc"
                                        value={newMilestone.description}
                                        onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })}
                                        placeholder="那天阳光很好..."
                                        rows={2}
                                    />
                                </div>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? '保存中...' : (
                                        <>
                                            <Heart size={16} /> 添加到故事
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </Card>
                </motion.div>
            )}

            {loading ? (
                <p className="text-center text-ink-muted py-8">加载故事中...</p>
            ) : milestones.length === 0 ? (
                <EmptyState icon="⭐" title="还没有记录故事" hint="点击上方按钮添加吧" />
            ) : (
                /* 时间线：移动端左侧单线，md 以上中央线 + 左右交错 */
                <div className="relative">
                    {/* 中线：两端渐隐的柔光线 */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 left-4 md:left-1/2 md:-translate-x-1/2 rounded-full bg-gradient-to-b from-accent/10 via-accent/50 to-accent/10"
                        aria-hidden
                    />
                    <div className="flex flex-col gap-8">
                        {milestones.map((item, index) => {
                            const isLeft = index % 2 === 0;
                            return (
                                <div
                                    key={item.id}
                                    className={cn(
                                        'timeline-reveal relative pl-12 md:pl-0 md:w-1/2',
                                        isLeft ? 'md:pr-12' : 'md:pl-12 md:ml-auto'
                                    )}
                                >
                                    {/* 节点 marker：白底光环 + 心形 */}
                                    <div
                                        className={cn(
                                            'absolute top-5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-accent bg-surface shadow-soft',
                                            'left-0 md:left-auto',
                                            isLeft
                                                ? 'md:right-0 md:translate-x-1/2'
                                                : 'md:left-0 md:-translate-x-1/2'
                                        )}
                                        aria-hidden
                                    >
                                        <Heart size={14} className="text-accent" fill="currentColor" />
                                    </div>
                                    <Card className={cn(
                                        'p-5 transition-all duration-300 ease-spring hover:shadow-lift hover:rotate-0 hover:-translate-y-0.5',
                                        isLeft ? 'md:rotate-[0.6deg]' : 'md:-rotate-[0.6deg]'
                                    )}>
                                        <div className="font-display text-2xl font-semibold tracking-wide text-accent">{item.date}</div>
                                        <h3 className="mt-2 font-display text-xl font-semibold tracking-wide text-ink mb-0">{item.title}</h3>
                                        {item.description && (
                                            <p className="mt-2 text-sm leading-loose text-ink-muted mb-0">
                                                {item.description}
                                            </p>
                                        )}
                                    </Card>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
