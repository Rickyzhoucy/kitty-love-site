"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, Check, Heart, Plus, Sparkles, Trash2 } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { plansApi, type Plan } from '@/lib/api/resources';
import WishSection from './WishSection';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

/**
 * 计划 = 要做的事。
 *
 * 这一页取代了旧的「备忘」。旧模型里「待办事项」和首页的「提醒」是两张表、
 * 两个页面，差别只有一个日期字段——现在合成一处，期限变成可选项
 * （见 docs/couple-site-feature-plan.md §0.1）。
 *
 * 想一起做但没有期限的事（想去吃 / 想去玩 / 想买的）不在这里，它们是「心愿」。
 */

function dueLabel(dueAt: string): { text: string; tone: 'overdue' | 'soon' | 'later' } {
    const diff = new Date(dueAt).getTime() - Date.now();
    const days = Math.floor(Math.abs(diff) / 86_400_000);
    if (diff < 0) return { text: days === 0 ? '今天已过' : `逾期 ${days} 天`, tone: 'overdue' };
    if (days === 0) return { text: '今天', tone: 'soon' };
    if (days === 1) return { text: '明天', tone: 'soon' };
    if (days < 7) return { text: `${days} 天后`, tone: 'soon' };
    return {
        text: new Date(dueAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        tone: 'later',
    };
}

const toneClass = {
    overdue: 'text-danger',
    soon: 'text-warning',
    later: 'text-ink-muted',
};

type Section = 'plans' | 'wishes';

export default function PlanPage() {
    const [section, setSection] = useState<Section>('plans');
    const [plans, setPlans] = useState<Plan[]>([]);
    const [title, setTitle] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setPlans(await plansApi.list());
        } catch (error) {
            console.error('Failed to fetch plans', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);
    useResourceEvents(['plans'], () => void load());

    const { dated, undated, done } = useMemo(() => {
        const open = plans.filter(item => !item.completedAt);
        return {
            // 有期限的按到期时间排，越急越靠前——这一组才是真正需要看的
            dated: open
                .filter(item => item.dueAt)
                .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime()),
            undated: open.filter(item => !item.dueAt),
            done: plans
                .filter(item => item.completedAt)
                .sort((a, b) =>
                    new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()),
        };
    }, [plans]);

    const add = async (event: React.FormEvent) => {
        event.preventDefault();
        const text = title.trim();
        if (!text) return;
        try {
            const created = await plansApi.create({
                title: text,
                // datetime-local 没有时区信息，交给浏览器按本地时区解释
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            });
            setPlans(current => [created, ...current]);
            setTitle('');
            setDueAt('');
        } catch (error) {
            toast(error instanceof Error ? error.message : '添加失败', 'error');
        }
    };

    const toggle = async (plan: Plan) => {
        const completedAt = plan.completedAt ? null : new Date().toISOString();
        const previous = plans;
        setPlans(current =>
            current.map(item => (item.id === plan.id ? { ...item, completedAt } : item)));
        try {
            await plansApi.update(plan.id, { completedAt });
        } catch {
            setPlans(previous);
            toast('操作失败，请重试', 'error');
        }
    };

    const remove = async (id: string) => {
        const previous = plans;
        setPlans(current => current.filter(item => item.id !== id));
        try {
            await plansApi.remove(id);
        } catch {
            setPlans(previous);
            toast('删除失败，请重试', 'error');
        }
    };

    const renderRow = (plan: Plan) => {
        const due = plan.dueAt ? dueLabel(plan.dueAt) : null;
        return (
            <motion.div
                key={plan.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="group flex items-center gap-3 rounded-md bg-sunken/60 px-3 py-2.5 transition-colors hover:bg-sunken"
            >
                <button
                    onClick={() => void toggle(plan)}
                    aria-label={plan.completedAt ? `取消完成 ${plan.title}` : `完成 ${plan.title}`}
                    className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors cursor-pointer',
                        plan.completedAt
                            ? 'border-accent bg-accent text-on-accent'
                            : 'border-ink-muted/40 bg-surface hover:border-accent'
                    )}
                >
                    {plan.completedAt && <Check size={12} />}
                </button>
                <span
                    className={cn(
                        'flex-1 break-words text-sm text-ink',
                        plan.completedAt && 'text-ink-muted line-through'
                    )}
                >
                    {plan.title}
                    {plan.note && (
                        <span className="ml-2 text-xs text-ink-muted">{plan.note}</span>
                    )}
                </span>
                {due && !plan.completedAt && (
                    <span className={cn('shrink-0 text-xs tabular-nums', toneClass[due.tone])}>
                        {due.text}
                    </span>
                )}
                <button
                    onClick={() => void remove(plan.id)}
                    aria-label={`删除 ${plan.title}`}
                    className="shrink-0 text-ink-muted/50 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer"
                >
                    <Trash2 size={15} />
                </button>
            </motion.div>
        );
    };

    return (
        <div className="mx-auto max-w-3xl px-4 py-6">
            <header className="mb-8 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Things To Do
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">我们的</span>
                    <span className="text-stroke-accent">计划</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    有期限的会催你，没期限的攒着慢慢来。
                </p>
            </header>

            {/* 计划和心愿的区别不是重要程度，是有没有期限。同页不同栏，
                而不是两个页面——原来「心愿」压根不在导航里，等于没人找得到。 */}
            <div className="mb-6 flex items-center gap-1 rounded-full bg-sunken/70 p-1" role="group" aria-label="分栏">
                {([
                    { id: 'plans' as const, label: '要做的事', icon: CalendarClock },
                    { id: 'wishes' as const, label: '想一起做的', icon: Sparkles },
                ]).map(item => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setSection(item.id)}
                            aria-pressed={section === item.id}
                            className={cn(
                                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors',
                                section === item.id
                                    ? 'bg-surface text-ink shadow-soft'
                                    : 'text-ink-muted hover:text-ink'
                            )}
                        >
                            <Icon size={15} /> {item.label}
                        </button>
                    );
                })}
            </div>

            {section === 'wishes' ? <WishSection /> : (<>

            <Card className="mb-8 p-5 md:p-6">
                <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row">
                    <Input
                        type="text"
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        placeholder="要做点什么…"
                        aria-label="计划内容"
                    />
                    <div className="flex gap-2">
                        <Input
                            type="datetime-local"
                            value={dueAt}
                            onChange={event => setDueAt(event.target.value)}
                            aria-label="截止时间（可留空）"
                            className="sm:w-52"
                        />
                        <button
                            type="submit"
                            aria-label="添加计划"
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95"
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                </form>
                <p className="mb-0 mt-2.5 text-xs text-ink-muted">
                    不填时间也可以，那样它只待在这一页，不会跑到首页去催你。
                </p>
            </Card>

            {loading ? (
                <p className="py-8 text-center text-ink-muted">加载中...</p>
            ) : plans.length === 0 ? (
                <EmptyState icon="🗒️" title="还没有计划" hint="想到什么就写下来吧" />
            ) : (
                <div className="flex flex-col gap-6">
                    {dated.length > 0 && (
                        <section>
                            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-ink">
                                <CalendarClock size={17} className="text-accent" />
                                有期限的
                                <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                                    {dated.length}
                                </span>
                            </h2>
                            <div className="flex flex-col gap-2">
                                <AnimatePresence>{dated.map(renderRow)}</AnimatePresence>
                            </div>
                        </section>
                    )}

                    {undated.length > 0 && (
                        <section>
                            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-ink">
                                <Heart size={17} className="text-accent" />
                                有空再说
                                <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                                    {undated.length}
                                </span>
                            </h2>
                            <div className="flex flex-col gap-2">
                                <AnimatePresence>{undated.map(renderRow)}</AnimatePresence>
                            </div>
                        </section>
                    )}

                    {done.length > 0 && (
                        <details className="rounded-lg border border-ink/5 bg-surface p-4 shadow-soft">
                            <summary className="cursor-pointer font-display text-base font-semibold tracking-wide text-ink-muted">
                                已完成 {done.length} 件
                            </summary>
                            <div className="mt-3 flex flex-col gap-2">{done.map(renderRow)}</div>
                        </details>
                    )}
                </div>
            )}
            </>)}
        </div>
    );
}
