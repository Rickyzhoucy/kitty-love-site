'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, MessageCircleQuestion, SmilePlus, X } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import {
    answerDailyQuestion,
    fetchDailyQuestion,
    type DailyQuestionState,
} from '@/lib/api/dailyQuestion';
import { checkInMood, fetchMoodBoard, type MoodBoard } from '@/lib/api/moods';
import { fetchLetters, writeLetter, type FutureLetter } from '@/lib/api/letters';
import { cn } from '@/lib/utils';

/**
 * 每日仪式面板：一问 / 心情 / 情书。
 *
 * 这三个原本各占一个导航 tab，但它们的共同点是**每天最多碰一次、每次十几秒**
 * ——为这种交互留三个常驻入口，代价是把真正每天要用的东西（故事、相册、聊天）
 * 挤到了横向滚动里。所以收进一个从宠物那儿点开的面板。
 *
 * 三块的顺序是有意的：一问要两个人都答才揭晓（最需要提醒），心情一点就完
 * （最轻），情书是偶尔为之（最低频）。
 */

type Tab = 'question' | 'mood' | 'letters';

const MOODS = [
    { value: 1, emoji: '😞', label: '很低落' },
    { value: 2, emoji: '😕', label: '有点低落' },
    { value: 3, emoji: '😐', label: '还行' },
    { value: 4, emoji: '🙂', label: '不错' },
    { value: 5, emoji: '😄', label: '很好' },
];

function todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function defaultUnlockAt(): string {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export default function DailyRitualPanel({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<Tab>('question');
    const [blocked, setBlocked] = useState<string | null>(null);

    const [question, setQuestion] = useState<DailyQuestionState | null>(null);
    const [answerDraft, setAnswerDraft] = useState('');
    const [board, setBoard] = useState<MoodBoard | null>(null);
    const [moodNote, setMoodNote] = useState('');
    const [letters, setLetters] = useState<FutureLetter[]>([]);
    const [letterBody, setLetterBody] = useState('');
    const [unlockDate, setUnlockDate] = useState(defaultUnlockAt);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [q, b, l] = await Promise.all([
                fetchDailyQuestion(),
                fetchMoodBoard(),
                fetchLetters(),
            ]);
            setQuestion(q);
            setBoard(b);
            setLetters(l);
            setMoodNote(b.mine.find(item => item.date === todayKey())?.note ?? '');
            setBlocked(null);
        } catch (reason) {
            if (reason instanceof ApiError && reason.status === 409) {
                setBlocked(reason.message);
            }
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const myMoodToday = board?.mine.find(item => item.date === todayKey());
    const theirMoodToday = board?.theirs.find(item => item.date === todayKey());

    const submitAnswer = async () => {
        const body = answerDraft.trim();
        if (!body || busy) return;
        setBusy(true);
        try {
            setQuestion(await answerDailyQuestion(body));
            setAnswerDraft('');
        } finally {
            setBusy(false);
        }
    };

    const submitMood = async (mood: number) => {
        if (busy) return;
        setBusy(true);
        try {
            setBoard(await checkInMood(mood, moodNote.trim() || null));
        } finally {
            setBusy(false);
        }
    };

    const submitLetter = async () => {
        const body = letterBody.trim();
        if (!body || busy) return;
        setBusy(true);
        try {
            await writeLetter(body, new Date(`${unlockDate}T00:00:00`).toISOString());
            setLetterBody('');
            setLetters(await fetchLetters());
        } finally {
            setBusy(false);
        }
    };

    const tabs: { id: Tab; label: string; icon: typeof SmilePlus; badge?: boolean }[] = [
        {
            id: 'question',
            label: '一问',
            icon: MessageCircleQuestion,
            // 还没答就提醒一下——这是三块里唯一有「该做还没做」状态的
            badge: Boolean(question && !question.myAnswer),
        },
        { id: 'mood', label: '心情', icon: SmilePlus, badge: Boolean(board && !myMoodToday) },
        { id: 'letters', label: '情书', icon: Mail },
    ];

    return (
        <section
            className="flex max-h-[70vh] w-[min(92vw,380px)] flex-col overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-lift"
            aria-label="每日仪式"
            data-pet-obstacle
        >
            <header className="flex items-center gap-1 border-b border-ink/5 p-1.5">
                {tabs.map(item => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            aria-pressed={tab === item.id}
                            className={cn(
                                'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm transition-colors',
                                tab === item.id
                                    ? 'bg-accent-soft text-accent'
                                    : 'text-ink-muted hover:text-ink'
                            )}
                        >
                            <Icon size={15} />
                            {item.label}
                            {item.badge && (
                                <span
                                    aria-hidden
                                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger"
                                />
                            )}
                        </button>
                    );
                })}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭"
                    className="shrink-0 cursor-pointer px-2 text-ink-muted hover:text-ink"
                >
                    <X size={15} />
                </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {blocked ? (
                    <p className="m-0 text-sm text-ink-muted">{blocked}</p>
                ) : tab === 'question' ? (
                    !question ? (
                        <p className="m-0 text-sm text-ink-muted">加载中…</p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <p className="m-0 font-display text-base font-semibold leading-relaxed text-ink">
                                {question.question.prompt}
                            </p>
                            {question.myAnswer ? (
                                <>
                                    <div className="rounded-md bg-sunken/60 p-3">
                                        <span className="text-xs text-ink-muted">我的回答</span>
                                        <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-ink">
                                            {question.myAnswer.body}
                                        </p>
                                    </div>
                                    <div className="rounded-md bg-sunken/40 p-3">
                                        <span className="text-xs text-ink-muted">
                                            {question.partner.displayName}的回答
                                        </span>
                                        <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-ink">
                                            {/* 两人都答完才有内容——服务端根本不发未揭晓的答案 */}
                                            {question.partnerAnswer
                                                ? question.partnerAnswer.body
                                                : `等 ${question.partner.displayName} 也答完就能看到。`}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <textarea
                                        value={answerDraft}
                                        onChange={event => setAnswerDraft(event.target.value)}
                                        placeholder="写下你的答案…"
                                        aria-label="我的回答"
                                        rows={3}
                                        className="w-full resize-none rounded-md border border-ink/10 bg-sunken/40 p-2.5 text-sm text-ink outline-none focus:border-accent"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void submitAnswer()}
                                        disabled={!answerDraft.trim() || busy}
                                        className="cursor-pointer self-end rounded-full bg-accent px-4 py-1.5 text-sm text-on-accent disabled:opacity-50"
                                    >
                                        提交
                                    </button>
                                </>
                            )}
                        </div>
                    )
                ) : tab === 'mood' ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-1">
                            {MOODS.map(item => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => void submitMood(item.value)}
                                    disabled={busy}
                                    aria-label={item.label}
                                    aria-pressed={myMoodToday?.mood === item.value}
                                    className={cn(
                                        'flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg py-2 transition-all',
                                        myMoodToday?.mood === item.value
                                            ? 'bg-accent-soft ring-2 ring-accent'
                                            : 'hover:bg-sunken active:scale-95'
                                    )}
                                >
                                    <span className="text-xl" aria-hidden>{item.emoji}</span>
                                </button>
                            ))}
                        </div>
                        <input
                            value={moodNote}
                            onChange={event => setMoodNote(event.target.value)}
                            onBlur={() => {
                                if (myMoodToday && moodNote.trim() !== (myMoodToday.note ?? '')) {
                                    void submitMood(myMoodToday.mood);
                                }
                            }}
                            placeholder="想说一句也可以"
                            aria-label="今天的备注"
                            maxLength={200}
                            className="w-full rounded-md border border-ink/10 bg-sunken/40 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                        />
                        {board && (
                            <p className="m-0 text-xs text-ink-muted">
                                {theirMoodToday
                                    ? `${board.partner.displayName}今天：${
                                        MOODS.find(m => m.value === theirMoodToday.mood)?.label
                                    }${theirMoodToday.note ? `「${theirMoodToday.note}」` : ''}`
                                    : `${board.partner.displayName}还没记今天的。`}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <textarea
                            value={letterBody}
                            onChange={event => setLetterBody(event.target.value)}
                            placeholder="写给以后的我们…"
                            aria-label="信的内容"
                            rows={4}
                            className="w-full resize-none rounded-md border border-ink/10 bg-sunken/40 p-2.5 text-sm text-ink outline-none focus:border-accent"
                        />
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={unlockDate}
                                onChange={event => setUnlockDate(event.target.value)}
                                aria-label="解锁日期"
                                className="flex-1 rounded-md border border-ink/10 bg-sunken/40 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                            />
                            <button
                                type="button"
                                onClick={() => void submitLetter()}
                                disabled={!letterBody.trim() || busy}
                                className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-sm text-on-accent disabled:opacity-50"
                            >
                                封起来
                            </button>
                        </div>
                        <p className="m-0 text-xs text-ink-muted">
                            封好之后谁都看不到里面，包括你自己。
                        </p>
                        {letters.length > 0 && (
                            <div className="flex flex-col gap-1.5 border-t border-ink/5 pt-3">
                                {letters.slice(0, 6).map(letter => (
                                    <div
                                        key={letter.id}
                                        className="rounded-md bg-sunken/50 px-2.5 py-2 text-xs"
                                    >
                                        <span className="text-ink-muted">
                                            {new Date(letter.unlockAt).toLocaleDateString('zh-CN')}
                                        </span>
                                        <span className="ml-2 text-ink">
                                            {/* body 为 null 就是还没到时候——服务端不发 */}
                                            {letter.body ?? '封着的'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
