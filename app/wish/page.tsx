"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plane, Plus, ShoppingBag, Trash2, Utensils } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { wishesApi, type Wish, type WishCategory } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

/**
 * 心愿 = 想一起做但没有期限的事。
 *
 * 由旧「备忘」的三个分类（想去吃 / 想去玩 / 想买的）演化而来。与「计划」的
 * 区别不是重要程度，是**有没有期限**：计划会催你，心愿只是攒着，做到了留个念想。
 */

const CATEGORIES: { id: WishCategory; label: string; icon: typeof Utensils; watermark: string }[] = [
    { id: 'to-eat', label: '想去吃', icon: Utensils, watermark: '吃' },
    { id: 'to-go', label: '想去玩', icon: Plane, watermark: '玩' },
    { id: 'to-buy', label: '想买的', icon: ShoppingBag, watermark: '买' },
];

function doneLabel(iso: string): string {
    const date = new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('zh-CN', {
        year: sameYear ? undefined : 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export default function WishPage() {
    const [wishes, setWishes] = useState<Wish[]>([]);
    const [text, setText] = useState('');
    const [category, setCategory] = useState<WishCategory>('to-eat');
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setWishes(await wishesApi.list());
        } catch (error) {
            console.error('Failed to fetch wishes', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);
    useResourceEvents(['wishes'], () => void load());

    const add = async (event: React.FormEvent) => {
        event.preventDefault();
        const title = text.trim();
        if (!title) return;
        try {
            const created = await wishesApi.create({ title, category });
            setWishes(current => [created, ...current]);
            setText('');
        } catch (error) {
            toast(error instanceof Error ? error.message : '添加失败', 'error');
        }
    };

    const toggle = async (wish: Wish) => {
        const completedAt = wish.completedAt ? null : new Date().toISOString();
        const previous = wishes;
        setWishes(current =>
            current.map(item => (item.id === wish.id ? { ...item, completedAt } : item)));
        try {
            await wishesApi.update(wish.id, { completedAt });
            if (completedAt) toast('又做到一件 🎉');
        } catch {
            setWishes(previous);
            toast('操作失败，请重试', 'error');
        }
    };

    const remove = async (id: string) => {
        const previous = wishes;
        setWishes(current => current.filter(item => item.id !== id));
        try {
            await wishesApi.remove(id);
        } catch {
            setWishes(previous);
            toast('删除失败，请重试', 'error');
        }
    };

    const doneCount = wishes.filter(item => item.completedAt).length;

    return (
        <div className="mx-auto max-w-6xl px-4 py-6">
            <header className="mb-8 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Wish List
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">想一起做的</span>
                    <span className="text-stroke-accent">事</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    {doneCount > 0
                        ? `已经一起做到 ${doneCount} 件了。`
                        : '没有期限，攒着慢慢来。'}
                    <Link href="/plan" className="ml-1 text-accent underline underline-offset-2">
                        有期限的去计划 →
                    </Link>
                </p>
            </header>

            <Card className="mb-8 p-5 md:p-6">
                <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="心愿分类">
                    {CATEGORIES.map(item => {
                        const active = category === item.id;
                        return (
                            <button
                                key={item.id}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setCategory(item.id)}
                                className={cn(
                                    'flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm transition-all',
                                    active
                                        ? 'border-accent bg-accent font-medium text-on-accent shadow-soft'
                                        : 'border-sunken bg-surface text-ink-muted hover:border-accent/40 hover:text-ink'
                                )}
                            >
                                <item.icon size={16} />
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <form onSubmit={add} className="flex gap-2">
                    <Input
                        type="text"
                        value={text}
                        onChange={event => setText(event.target.value)}
                        placeholder={`添加到 ${CATEGORIES.find(c => c.id === category)?.label}...`}
                        aria-label="心愿内容"
                    />
                    <button
                        type="submit"
                        aria-label="添加心愿"
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95"
                    >
                        <Plus size={20} />
                    </button>
                </form>
            </Card>

            {loading ? (
                <p className="py-8 text-center text-ink-muted">加载中...</p>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {CATEGORIES.map(cat => {
                        const items = wishes.filter(item => item.category === cat.id);
                        return (
                            <div
                                key={cat.id}
                                className="relative overflow-hidden rounded-lg border border-ink/5 bg-surface p-4 shadow-soft"
                            >
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute -bottom-6 -right-2 select-none font-display text-8xl font-semibold leading-none text-accent/[0.07]"
                                >
                                    {cat.watermark}
                                </span>
                                <h3 className="relative mb-3 mt-0 flex items-center gap-2.5 border-b border-sunken pb-3 font-display text-lg font-semibold tracking-wide text-ink">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                                        <cat.icon size={15} />
                                    </span>
                                    {cat.label}
                                    <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                                        {items.length}
                                    </span>
                                </h3>
                                <div className="relative flex flex-col gap-2">
                                    <AnimatePresence>
                                        {items.length === 0 ? (
                                            <p className="py-4 text-center text-sm text-ink-muted/70">
                                                这里还是空的哦...
                                            </p>
                                        ) : (
                                            items.map(wish => (
                                                <motion.div
                                                    key={wish.id}
                                                    layout
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    className="group flex items-start gap-2.5 rounded-md bg-sunken/60 px-3 py-2.5 transition-colors hover:bg-sunken"
                                                >
                                                    <button
                                                        onClick={() => void toggle(wish)}
                                                        aria-label={
                                                            wish.completedAt
                                                                ? `取消完成 ${wish.title}`
                                                                : `完成 ${wish.title}`
                                                        }
                                                        className={cn(
                                                            'mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                                                            wish.completedAt
                                                                ? 'border-accent bg-accent text-on-accent'
                                                                : 'border-ink-muted/40 bg-surface hover:border-accent'
                                                        )}
                                                    >
                                                        {wish.completedAt && <Check size={12} />}
                                                    </button>
                                                    <span className="flex-1 break-words text-sm">
                                                        <span
                                                            className={cn(
                                                                'text-ink',
                                                                wish.completedAt
                                                                    && 'text-ink-muted line-through'
                                                            )}
                                                        >
                                                            {wish.title}
                                                        </span>
                                                        {/* 完成时间是这一页存在的理由之一：
                                                            回头看「我们在哪天做到的」本身就是内容 */}
                                                        {wish.completedAt && (
                                                            <span className="mt-0.5 block text-xs text-accent">
                                                                {doneLabel(wish.completedAt)} 做到了
                                                            </span>
                                                        )}
                                                    </span>
                                                    <button
                                                        onClick={() => void remove(wish.id)}
                                                        aria-label={`删除 ${wish.title}`}
                                                        className="mt-0.5 shrink-0 cursor-pointer text-ink-muted/50 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={15} />
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
            )}
        </div>
    );
}
