'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, MailOpen, PenLine, Send } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import {
    fetchLetter,
    fetchLetters,
    writeLetter,
    type FutureLetter,
} from '@/lib/api/letters';
import { cn } from '@/lib/utils';

/**
 * 未来情书（计划文档 §2.6）。
 *
 * 这一页**没有任何「要不要显示正文」的判断**——因为不需要：锁着的信服务端
 * 根本不返回正文，`body` 就是 null。这不是偷懒，是这个功能唯一的安全要求：
 * 只在前端藏等于没锁。
 */

function countdown(unlockAt: string): string {
    const diff = new Date(unlockAt).getTime() - Date.now();
    if (diff <= 0) return '可以打开了';
    const days = Math.floor(diff / 86_400_000);
    if (days > 30) {
        const months = Math.round(days / 30);
        return `还有大约 ${months} 个月`;
    }
    if (days > 0) return `还有 ${days} 天`;
    const hours = Math.floor(diff / 3_600_000);
    if (hours > 0) return `还有 ${hours} 小时`;
    return '就快了';
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/** 默认解锁时间：一年后的今天。写情书最常见的跨度。 */
function defaultUnlockAt(): string {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export default function LettersPage() {
    const [letters, setLetters] = useState<FutureLetter[]>([]);
    const [loading, setLoading] = useState(true);
    const [composing, setComposing] = useState(false);
    const [body, setBody] = useState('');
    const [unlockDate, setUnlockDate] = useState(defaultUnlockAt);
    const [sending, setSending] = useState(false);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setLetters(await fetchLetters());
        } catch {
            toast('信箱读不出来', 'error');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
    }, [load]);

    const send = async (event: React.FormEvent) => {
        event.preventDefault();
        const text = body.trim();
        if (!text || sending) return;
        setSending(true);
        try {
            // date input 只有日期，补成当天 0 点（本地时区）
            await writeLetter(text, new Date(`${unlockDate}T00:00:00`).toISOString());
            setBody('');
            setUnlockDate(defaultUnlockAt());
            setComposing(false);
            await load();
        } catch (reason) {
            toast(reason instanceof Error ? reason.message : '寄不出去', 'error');
        } finally {
            setSending(false);
        }
    };

    /** 解锁了但还没读过的，点开时顺便让服务端记下 openedAt。 */
    const open = async (letter: FutureLetter) => {
        if (!letter.unlocked || letter.body !== null) return;
        try {
            const fresh = await fetchLetter(letter.id);
            setLetters(current =>
                current.map(item => (item.id === fresh.id ? fresh : item)));
        } catch {
            toast('这封信打不开', 'error');
        }
    };

    return (
        <div className="mx-auto max-w-2xl px-4 py-6">
            <header className="mb-8 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Letters To The Future
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">未来</span>
                    <span className="text-stroke-accent">情书</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    写下来，封起来，到那天才打开。写的人也不能提前看。
                </p>
            </header>

            {composing ? (
                <Card className="mb-6 p-5 md:p-6">
                    <form onSubmit={send}>
                        <textarea
                            value={body}
                            onChange={event => setBody(event.target.value)}
                            placeholder="想对那时候的我们说点什么…"
                            aria-label="信的内容"
                            rows={7}
                            autoFocus
                            className="w-full resize-none rounded-md border border-ink/10 bg-sunken/40 p-3 text-sm leading-relaxed text-ink outline-none transition-colors focus:border-accent"
                        />
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                            <label className="flex items-center gap-2 text-sm text-ink-muted">
                                <span className="shrink-0">哪天打开</span>
                                <Input
                                    type="date"
                                    value={unlockDate}
                                    onChange={event => setUnlockDate(event.target.value)}
                                    aria-label="解锁日期"
                                    className="sm:w-44"
                                />
                            </label>
                            <div className="flex gap-2 sm:ml-auto">
                                <button
                                    type="button"
                                    onClick={() => setComposing(false)}
                                    className="cursor-pointer rounded-full px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
                                >
                                    算了
                                </button>
                                <button
                                    type="submit"
                                    disabled={!body.trim() || sending}
                                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95 disabled:opacity-50"
                                >
                                    <Send size={15} />
                                    {sending ? '封起来…' : '封起来'}
                                </button>
                            </div>
                        </div>
                        <p className="mb-0 mt-2.5 text-xs text-ink-muted">
                            封好之后谁都看不到里面，包括你自己——所以想清楚再写。
                        </p>
                    </form>
                </Card>
            ) : (
                <button
                    type="button"
                    onClick={() => setComposing(true)}
                    className="mb-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent-soft/30 py-3.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                    <PenLine size={16} />
                    写一封
                </button>
            )}

            {loading ? (
                <p className="py-8 text-center text-ink-muted">加载中...</p>
            ) : letters.length === 0 ? (
                <EmptyState
                    icon="💌"
                    title="还没有信"
                    hint="写一封给一年后的我们"
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {letters.map(letter => {
                        const readable = letter.body !== null;
                        return (
                            <Card
                                key={letter.id}
                                className={cn(
                                    'p-5',
                                    !letter.unlocked && 'bg-sunken/40',
                                    letter.unlocked && !readable && 'cursor-pointer hover:border-accent/40'
                                )}
                                onClick={() => void open(letter)}
                            >
                                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                                    {letter.unlocked ? (
                                        <MailOpen size={13} className="text-accent" />
                                    ) : (
                                        <Lock size={13} />
                                    )}
                                    <span>{formatDate(letter.unlockAt)}</span>
                                    <span className="ml-auto">
                                        {letter.unlocked ? '已解锁' : countdown(letter.unlockAt)}
                                    </span>
                                </div>
                                {readable ? (
                                    <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                        {letter.body}
                                    </p>
                                ) : letter.unlocked ? (
                                    <p className="m-0 text-sm text-accent">
                                        点开看看 →
                                    </p>
                                ) : (
                                    <p className="m-0 text-sm text-ink-muted">
                                        封着的。到那天再说。
                                    </p>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
