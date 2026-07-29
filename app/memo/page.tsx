"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Check, Utensils, Plane, ShoppingBag, List } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { memosApi, type Memo } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

const CATEGORIES = [
    { id: 'to-eat', label: '想去吃', icon: Utensils, watermark: '吃' },
    { id: 'to-go', label: '想去玩', icon: Plane, watermark: '玩' },
    { id: 'to-buy', label: '想买的', icon: ShoppingBag, watermark: '买' },
    { id: 'todo', label: '待办事项', icon: List, watermark: '办' },
];

export default function MemoPage() {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [newMemoText, setNewMemoText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[3].id);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const loadMemos = useCallback(async () => {
        try {
            setMemos(await memosApi.list());
        } catch (error) {
            console.error('Failed to fetch', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMemos();
    }, [loadMemos]);
    useResourceEvents(['memos'], () => void loadMemos());

    const addMemo = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMemoText.trim()) return;

        try {
            const newMemo = await memosApi.create({ category: selectedCategory, text: newMemoText });
            setMemos([newMemo, ...memos]);
            setNewMemoText('');
        } catch (error) {
            toast(error instanceof Error ? error.message : '添加失败', 'error');
        }
    };

    const toggleComplete = async (id: string, currentStatus: boolean) => {
        setMemos(memos.map(m => (m.id === id ? { ...m, completed: !currentStatus } : m)));
        try {
            await memosApi.update(id, !currentStatus);
        } catch {
            setMemos(memos.map(m => (m.id === id ? { ...m, completed: currentStatus } : m)));
            toast('操作失败，请重试', 'error');
        }
    };

    const deleteMemo = async (id: string) => {
        const previous = [...memos];
        setMemos(memos.filter(m => m.id !== id));
        try {
            await memosApi.remove(id);
        } catch {
            setMemos(previous);
            toast('删除失败，请重试', 'error');
        }
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-6">
            {/* 巨型排版页头 */}
            <header className="mb-10 pt-2 animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-accent m-0">Our Little Plans</p>
                <h1 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide m-0">
                    <span className="text-ink">可爱</span>
                    <span className="text-stroke-accent">计划</span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-ink-muted mb-0">和你一起做的每一件小事，都是大事</p>
            </header>

            <Card className="p-5 md:p-6 mb-8">
                {/* 分类选择器：选中态实心 accent 胶囊 */}
                <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="备忘分类">
                    {CATEGORIES.map(cat => {
                        const active = selectedCategory === cat.id;
                        return (
                            <button
                                key={cat.id}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={cn(
                                    'flex items-center gap-1.5 h-10 px-4 rounded-full border text-sm transition-all cursor-pointer',
                                    active
                                        ? 'border-accent bg-accent text-on-accent font-medium shadow-soft'
                                        : 'border-sunken bg-surface text-ink-muted hover:border-accent/40 hover:text-ink'
                                )}
                            >
                                <cat.icon size={16} />
                                {cat.label}
                            </button>
                        );
                    })}
                </div>

                <form onSubmit={addMemo} className="flex gap-2">
                    <Input
                        type="text"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        placeholder={`添加到 ${CATEGORIES.find(c => c.id === selectedCategory)?.label}...`}
                        aria-label="备忘内容"
                    />
                    <button
                        type="submit"
                        aria-label="添加备忘"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95 cursor-pointer"
                    >
                        <Plus size={20} />
                    </button>
                </form>
            </Card>

            {loading ? (
                <p className="text-center text-ink-muted py-8">加载中...</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {CATEGORIES.map(cat => {
                        const catMemos = memos.filter(m => m.category === cat.id);
                        return (
                            <div key={cat.id} className="relative overflow-hidden rounded-lg border border-ink/5 bg-surface p-4 shadow-soft">
                                {/* 巨型水印字 */}
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute -bottom-6 -right-2 font-display text-8xl font-semibold leading-none text-accent/[0.07] select-none"
                                >
                                    {cat.watermark}
                                </span>
                                <h3 className="relative flex items-center gap-2.5 font-display text-lg font-semibold tracking-wide text-ink mt-0 mb-3 pb-3 border-b border-sunken">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                                        <cat.icon size={15} />
                                    </span>
                                    {cat.label}
                                    <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                                        {catMemos.length}
                                    </span>
                                </h3>
                                <div className="flex flex-col gap-2">
                                    <AnimatePresence>
                                        {catMemos.length === 0 ? (
                                            <p className="text-sm text-ink-muted/70 py-4 text-center">这里还是空的哦...</p>
                                        ) : (
                                            catMemos.map(memo => (
                                                <motion.div
                                                    key={memo.id}
                                                    layout
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    className="group flex items-center gap-2.5 rounded-md bg-sunken/60 px-3 py-2.5 transition-colors hover:bg-sunken"
                                                >
                                                    <button
                                                        onClick={() => toggleComplete(memo.id, memo.completed)}
                                                        aria-label={memo.completed ? `取消完成 ${memo.text}` : `完成 ${memo.text}`}
                                                        className={cn(
                                                            'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors cursor-pointer',
                                                            memo.completed
                                                                ? 'border-accent bg-accent text-on-accent'
                                                                : 'border-ink-muted/40 bg-surface hover:border-accent'
                                                        )}
                                                    >
                                                        {memo.completed && <Check size={12} />}
                                                    </button>
                                                    <span
                                                        className={cn(
                                                            'flex-1 text-sm text-ink break-words',
                                                            memo.completed && 'line-through text-ink-muted'
                                                        )}
                                                    >
                                                        {memo.text}
                                                    </span>
                                                    {/* 移动端常显，桌面 hover 显示 */}
                                                    <button
                                                        onClick={() => deleteMemo(memo.id)}
                                                        aria-label={`删除 ${memo.text}`}
                                                        className="shrink-0 text-danger/70 transition-all hover:text-danger md:opacity-0 md:group-hover:opacity-100 cursor-pointer"
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
            )}
        </div>
    );
}
