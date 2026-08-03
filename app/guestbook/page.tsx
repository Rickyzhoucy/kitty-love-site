"use client";

import { useState, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { format } from 'date-fns';
import Button from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { messagesApi, type Message } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

export default function Guestbook() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [nickname, setNickname] = useState('');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const { toast } = useToast();

    const loadMessages = useCallback(async () => {
        try {
            setMessages(await messagesApi.list());
        } catch (error) {
            console.error('Failed to fetch messages', error);
        } finally {
            setFetching(false);
        }
    }, []);

    useEffect(() => {
        void loadMessages();
    }, [loadMessages]);
    useResourceEvents(['messages'], () => void loadMessages());

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nickname.trim() || !content.trim()) return;

        setLoading(true);
        try {
            await messagesApi.create({ nickname, content });
            // **不做乐观插入。** 这一页同时还挂着 SSE 重取（useResourceEvents），
            // 两条路谁先到不一定：乐观插入用的是提交那一刻的 `messages` 闭包，
            // 如果重取先落地，这一插就把对方在这期间发的留言又抹掉了。
            // 直接以服务器为准重取一次，慢一个来回，但不会丢别人的话。
            await loadMessages();
            setContent('');
            toast('留言成功 💌');
        } catch (error) {
            toast(error instanceof Error ? error.message : '发送失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mx-auto max-w-5xl px-4 py-6">
            {/* 巨型排版页头 */}
            <header className="mb-10 pt-2 animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-accent m-0">Leave A Message</p>
                <h1 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide m-0">
                    <span className="text-ink">留言</span>
                    <span className="text-stroke-accent">板</span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-ink-muted mb-0">写下你想对我说的话吧</p>
            </header>

            {/* 信纸书写卡：胶带封口 + 收信人 + 书写区 */}
            <div className="relative mb-12 rounded-lg border border-ink/5 bg-surface p-6 pt-8 shadow-lift md:-rotate-[0.5deg] md:p-8 md:pt-10">
                {/* 胶带封口 */}
                <span
                    aria-hidden
                    className="absolute -top-3 left-1/2 h-7 w-32 -translate-x-1/2 -rotate-2 rounded-[2px] bg-accent-soft/90 shadow-sm"
                />
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <p className="font-display text-2xl font-semibold tracking-wide text-ink m-0">
                        亲爱的，<span className="text-accent">见字如面</span>
                    </p>
                    <Textarea
                        placeholder="在这里写下你的留言..."
                        aria-label="留言内容"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        maxLength={200}
                        rows={4}
                        required
                        className="border-0 bg-transparent px-0 font-display text-lg leading-loose focus:bg-transparent focus:shadow-none"
                    />
                    <div className="flex items-end justify-between gap-4 border-t border-sunken pt-4">
                        <Input
                            type="text"
                            placeholder="你的昵称"
                            aria-label="昵称"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            maxLength={20}
                            required
                            className="max-w-[180px] border-0 border-b border-sunken rounded-none bg-transparent px-0 focus:border-accent focus:bg-transparent focus:shadow-none"
                        />
                        <Button type="submit" disabled={loading}>
                            {loading ? '发送中...' : (
                                <>
                                    发送 <Send size={16} />
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>

            {fetching ? (
                <p className="text-center text-ink-muted py-8">加载留言中...</p>
            ) : messages.length === 0 ? (
                <EmptyState icon="💌" title="还没有留言哦" hint="快来抢沙发！" />
            ) : (
                /* 瀑布流便签墙：自然错落 + 胶带两色交替 */
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
                    {messages.map((msg, index) => (
                            /**
                             * **这面墙上不能有 JS 驱动的入场动画。**
                             *
                             * 原来是 framer-motion 的 `initial={{opacity:0}}` →
                             * `animate={{opacity:1}}`。motion 走 rAF，而窗口切到后台时
                             * rAF 会被节流甚至停掉——动画停在哪儿，内联样式就停在哪儿。
                             * 实测后台标签页里卡片停在 `opacity: 0; transform: scale(0.9)`，
                             * 也就是**留言直接看不见了**。桌面版那个窗口天天在后台。
                             *
                             * 现在改成：可见是默认状态，不依赖任何动画跑完。倾斜回到
                             * Tailwind 类（没有 motion 写内联 transform 来盖它了，
                             * 这也是原先整面墙从来没斜过的原因），悬停用 CSS transition。
                             *
                             * 顺带去掉了 `layout` 和 `AnimatePresence`：布局动画会给多列
                             * 容器做绝对定位，卡片在列之间跳，还会留下浮在别处的空白块。
                             */
                            <div
                                key={msg.id}
                                className={cn(
                                    'relative mb-6 break-inside-avoid rounded-sm bg-surface px-5 pb-5 pt-9 shadow-lift',
                                    'transition-transform duration-300 ease-spring hover:rotate-0 hover:-translate-y-1',
                                    index % 2 === 0 ? 'rotate-[1.5deg]' : '-rotate-[1.5deg]'
                                )}
                            >
                                {/* 和纸胶带：两色交替 */}
                                <span
                                    className={cn(
                                        'absolute -top-2.5 left-1/2 h-6 w-24 -translate-x-1/2 rounded-[2px] shadow-sm',
                                        index % 2 === 0 ? '-rotate-3 bg-accent-soft/90' : 'rotate-2 bg-secondary-soft/90'
                                    )}
                                    aria-hidden
                                />
                                {/* 巨型引号装饰 */}
                                <span aria-hidden className="block font-display text-5xl leading-[0.5] text-accent/25 select-none">“</span>
                                <p className="mt-3 text-ink leading-loose m-0">{msg.content}</p>
                                <div className="mt-4 flex items-center justify-between border-t border-sunken pt-3 text-sm">
                                    <span className="font-display font-semibold text-accent">— {msg.nickname}</span>
                                    <span className="text-xs tracking-wide text-ink-muted">
                                        {format(new Date(msg.createdAt), 'yyyy.MM.dd')}
                                    </span>
                                </div>
                            </div>
                    ))}
                </div>
            )}
        </div>
    );
}
