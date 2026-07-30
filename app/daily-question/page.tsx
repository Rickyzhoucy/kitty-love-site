'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Send, Unlock } from 'lucide-react';
import Card from '../components/ui/Card';
import { useToast } from '../components/ui/Toast';
import { ApiError } from '@/lib/api/client';
import {
    answerDailyQuestion,
    fetchDailyQuestion,
    type DailyQuestionState,
} from '@/lib/api/dailyQuestion';
import { cn } from '@/lib/utils';

/**
 * 每日一问（计划文档 §2.1）。
 *
 * 核心机制来自 Paired：**两个人都答完才能看到对方的答案**。这不是防作弊，
 * 是把回答从表演变成交换——所以这一页刻意不在我已经答完时偷看对方那一栏，
 * 即使接口因为某种原因提前给了数据，UI 也只按 `partnerAnswered` 判断显示。
 */

const CATEGORY_LABEL: Record<string, string> = {
    daily: '日常',
    memory: '回忆',
    imagine: '想象',
    confess: '坦白',
};

function formatDate(iso: string): string {
    // question.date 是 YYYY-MM-DD，直接构造避免时区把日期挪到前一天
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
    });
}

export default function DailyQuestionPage() {
    const [state, setState] = useState<DailyQuestionState | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            const data = await fetchDailyQuestion();
            setState(data);
            setBlocked(null);
            if (!data.myAnswer) setDraft('');
            return data;
        } catch (reason) {
            if (reason instanceof ApiError && reason.status === 409) {
                setBlocked(reason.message);
            } else {
                toast('今天的题加载失败', 'error');
            }
            return null;
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
    }, [load]);

    const submit = async () => {
        const body = draft.trim();
        if (!body || submitting) return;
        setSubmitting(true);
        try {
            const data = await answerDailyQuestion(body);
            setState(data);
            setEditing(false);
        } catch (reason) {
            toast(reason instanceof Error ? reason.message : '提交失败，请重试', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = () => {
        setDraft(state?.myAnswer?.body ?? '');
        setEditing(true);
    };

    if (blocked) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-6">
                <Card className="p-6 text-center text-sm text-ink-muted">
                    {blocked}
                </Card>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6">
            <header className="mb-8 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Daily Question
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">每日</span>
                    <span className="text-stroke-accent">一问</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    两个人都答完，才能看到对方写了什么。
                </p>
            </header>

            {loading ? (
                <p className="py-8 text-center text-ink-muted">加载中...</p>
            ) : !state ? null : (
                <div className="flex flex-col gap-5">
                    <Card className="p-5 md:p-6">
                        <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
                            <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">
                                {CATEGORY_LABEL[state.question.category] ?? state.question.category}
                            </span>
                            <span>{formatDate(state.question.date)}</span>
                        </div>
                        <p className="m-0 font-display text-xl font-semibold leading-relaxed text-ink md:text-2xl">
                            {state.question.prompt}
                        </p>
                    </Card>

                    {!state.myAnswer || editing ? (
                        <Card className="p-5 md:p-6">
                            <textarea
                                value={draft}
                                onChange={event => setDraft(event.target.value)}
                                placeholder="写下你的答案…"
                                aria-label="我的回答"
                                rows={4}
                                autoFocus
                                className="w-full resize-none rounded-md border border-ink/10 bg-sunken/40 p-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                            />
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="m-0 text-xs text-ink-muted">
                                    提交前你可以随便改；对方还没答完的时候，改主意也没关系。
                                </p>
                                <button
                                    type="button"
                                    onClick={() => void submit()}
                                    disabled={!draft.trim() || submitting}
                                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95 disabled:opacity-50"
                                >
                                    <Send size={15} />
                                    {submitting ? '提交中…' : '提交回答'}
                                </button>
                            </div>
                        </Card>
                    ) : (
                        <Card className="p-5 md:p-6">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium text-ink-muted">我的回答</span>
                                <button
                                    type="button"
                                    onClick={startEdit}
                                    className="text-xs text-accent underline underline-offset-2"
                                >
                                    改一下
                                </button>
                            </div>
                            <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                {state.myAnswer.body}
                            </p>
                        </Card>
                    )}

                    {!editing && (
                        <Card
                            className={cn(
                                'p-5 md:p-6',
                                !state.partnerAnswer && 'bg-sunken/40'
                            )}
                        >
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                                {state.partnerAnswer ? (
                                    <Unlock size={13} className="text-accent" />
                                ) : (
                                    <Lock size={13} />
                                )}
                                {state.partner.displayName}的回答
                            </div>
                            {state.partnerAnswer ? (
                                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                    {state.partnerAnswer.body}
                                </p>
                            ) : !state.myAnswer ? (
                                <p className="m-0 text-sm text-ink-muted">
                                    {state.partnerAnswered
                                        ? `${state.partner.displayName} 已经答完了，你答完就能看到。`
                                        : '你们都还没答，先写下你的答案吧。'}
                                </p>
                            ) : (
                                <p className="m-0 text-sm text-ink-muted">
                                    {`等 ${state.partner.displayName} 也答完就能看到啦。`}
                                </p>
                            )}
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
