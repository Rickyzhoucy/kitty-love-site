'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Card from '../components/ui/Card';
import { useToast } from '../components/ui/Toast';
import { ApiError } from '@/lib/api/client';
import {
    checkInMood,
    fetchMoodBoard,
    type MoodBoard,
    type MoodEntry,
} from '@/lib/api/moods';
import { cn } from '@/lib/utils';

/**
 * 情绪打卡（计划文档 §2.4）。
 *
 * 曲线只是副产品——这个功能真正的作用是给宠物一个**有依据的**关心理由：
 * 从「你很久没互动了」变成「对方今天标了低落」。所以打卡这件事本身要足够轻，
 * 五个表情点一下就完事，不逼人写字。
 */

const MOODS: { value: number; emoji: string; label: string }[] = [
    { value: 1, emoji: '😞', label: '很低落' },
    { value: 2, emoji: '😕', label: '有点低落' },
    { value: 3, emoji: '😐', label: '还行' },
    { value: 4, emoji: '🙂', label: '不错' },
    { value: 5, emoji: '😄', label: '很好' },
];

/** 曲线回看天数。两周刚好在手机上一屏画得开。 */
const WINDOW_DAYS = 14;

function emojiOf(mood: number): string {
    return MOODS.find(item => item.value === mood)?.emoji ?? '·';
}

function labelOf(mood: number): string {
    return MOODS.find(item => item.value === mood)?.label ?? '说不清';
}

/** 最近 N 天的日期（YYYY-MM-DD），今天在最后。 */
function recentDays(days: number): string[] {
    const today = new Date();
    return Array.from({ length: days }, (_, index) => {
        const day = new Date(today);
        day.setDate(today.getDate() - (days - 1 - index));
        // 用本地时间拼，避免 toISOString 的 UTC 把日期挪到前一天
        return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    });
}

/**
 * 两条折线。刻意手写 SVG 而不是引图表库：这里只有两条 14 点的线，
 * 引一个库要付的体积和它给的东西不成比例。
 */
function MoodChart({
    days,
    mine,
    theirs,
    partnerName,
}: {
    days: string[];
    mine: Map<string, MoodEntry>;
    theirs: Map<string, MoodEntry>;
    partnerName: string;
}) {
    const width = 100;
    const height = 42;
    const step = days.length > 1 ? width / (days.length - 1) : 0;
    // mood 1..5 → y 从下到上，留出上下边距
    const yOf = (mood: number) => height - 4 - ((mood - 1) / 4) * (height - 8);

    const pointsOf = (source: Map<string, MoodEntry>) =>
        days
            .map((day, index) => {
                const entry = source.get(day);
                return entry ? { x: index * step, y: yOf(entry.mood) } : null;
            })
            .filter((point): point is { x: number; y: number } => point !== null);

    const minePoints = pointsOf(mine);
    const theirPoints = pointsOf(theirs);

    if (!minePoints.length && !theirPoints.length) {
        return (
            <p className="m-0 py-6 text-center text-sm text-ink-muted">
                打上几天卡，这里就会有两条线。
            </p>
        );
    }

    const line = (points: { x: number; y: number }[]) =>
        points.map(point => `${point.x},${point.y}`).join(' ');

    return (
        <div className="overflow-x-auto">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-32 w-full min-w-[280px]"
                role="img"
                aria-label={`我和${partnerName}最近 ${days.length} 天的心情曲线`}
            >
                {[1, 3, 5].map(level => (
                    <line
                        key={level}
                        x1={0}
                        x2={width}
                        y1={yOf(level)}
                        y2={yOf(level)}
                        stroke="currentColor"
                        strokeWidth={0.2}
                        className="text-ink-muted/25"
                    />
                ))}
                {theirPoints.length > 0 && (
                    <polyline
                        points={line(theirPoints)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-ink-muted"
                    />
                )}
                {minePoints.length > 0 && (
                    <polyline
                        points={line(minePoints)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-accent"
                    />
                )}
                {theirPoints.map(point => (
                    <circle
                        key={`t-${point.x}`}
                        cx={point.x}
                        cy={point.y}
                        r={0.9}
                        className="fill-ink-muted"
                    />
                ))}
                {minePoints.map(point => (
                    <circle
                        key={`m-${point.x}`}
                        cx={point.x}
                        cy={point.y}
                        r={0.9}
                        className="fill-accent"
                    />
                ))}
            </svg>
        </div>
    );
}

export default function MoodPage() {
    const [board, setBoard] = useState<MoodBoard | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setBoard(await fetchMoodBoard());
            setBlocked(null);
        } catch (reason) {
            if (reason instanceof ApiError && reason.status === 409) {
                setBlocked(reason.message);
            } else {
                toast('心情记录读不出来', 'error');
            }
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
    }, [load]);

    const days = useMemo(() => recentDays(WINDOW_DAYS), []);
    const mineByDay = useMemo(
        () => new Map((board?.mine ?? []).map(entry => [entry.date, entry])),
        [board],
    );
    const theirsByDay = useMemo(
        () => new Map((board?.theirs ?? []).map(entry => [entry.date, entry])),
        [board],
    );

    const today = days[days.length - 1];
    const myToday = mineByDay.get(today);
    const theirToday = theirsByDay.get(today);

    useEffect(() => {
        setNote(myToday?.note ?? '');
    }, [myToday]);

    const checkIn = async (mood: number) => {
        if (saving) return;
        setSaving(true);
        try {
            setBoard(await checkInMood(mood, note.trim() || null));
        } catch (reason) {
            toast(reason instanceof Error ? reason.message : '打卡失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (blocked) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-6">
                <Card className="p-6 text-center text-sm text-ink-muted">{blocked}</Card>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-6">
            <header className="mb-8 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    How We Feel
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">今天</span>
                    <span className="text-stroke-accent">心情</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    点一下就好。不用解释为什么。
                </p>
            </header>

            {loading ? (
                <p className="py-8 text-center text-ink-muted">加载中...</p>
            ) : !board ? null : (
                <div className="flex flex-col gap-5">
                    <Card className="p-5 md:p-6">
                        <div className="flex items-center justify-between gap-2">
                            {MOODS.map(item => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => void checkIn(item.value)}
                                    disabled={saving}
                                    aria-label={item.label}
                                    aria-pressed={myToday?.mood === item.value}
                                    className={cn(
                                        'flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg py-2.5 transition-all',
                                        myToday?.mood === item.value
                                            ? 'bg-accent-soft ring-2 ring-accent'
                                            : 'hover:bg-sunken active:scale-95'
                                    )}
                                >
                                    <span className="text-2xl" aria-hidden>{item.emoji}</span>
                                    <span className="text-[10px] text-ink-muted">{item.label}</span>
                                </button>
                            ))}
                        </div>
                        <input
                            value={note}
                            onChange={event => setNote(event.target.value)}
                            onBlur={() => {
                                // 只在已经打过卡、且备注真的变了的时候补一次
                                if (myToday && note.trim() !== (myToday.note ?? '')) {
                                    void checkIn(myToday.mood);
                                }
                            }}
                            placeholder="想说一句也可以（可留空）"
                            aria-label="今天的备注"
                            maxLength={200}
                            className="mt-4 w-full rounded-md border border-ink/10 bg-sunken/40 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
                        />
                        <p className="mb-0 mt-2 text-xs text-ink-muted">
                            {myToday
                                ? `今天记的是「${labelOf(myToday.mood)}」，改一下就是重新记。`
                                : '今天还没记。'}
                        </p>
                    </Card>

                    <Card className="p-5 md:p-6">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="m-0 font-display text-lg font-semibold tracking-wide text-ink">
                                最近两周
                            </h2>
                            <div className="flex items-center gap-3 text-xs text-ink-muted">
                                <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
                                    我
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-ink-muted" aria-hidden />
                                    {board.partner.displayName}
                                </span>
                            </div>
                        </div>
                        <MoodChart
                            days={days}
                            mine={mineByDay}
                            theirs={theirsByDay}
                            partnerName={board.partner.displayName}
                        />
                    </Card>

                    <Card className="p-5 md:p-6">
                        <h2 className="m-0 mb-3 font-display text-lg font-semibold tracking-wide text-ink">
                            {board.partner.displayName}今天
                        </h2>
                        {theirToday ? (
                            <p className="m-0 flex items-center gap-2 text-sm text-ink">
                                <span className="text-2xl" aria-hidden>
                                    {emojiOf(theirToday.mood)}
                                </span>
                                <span>
                                    {labelOf(theirToday.mood)}
                                    {theirToday.note && (
                                        <span className="ml-1.5 text-ink-muted">
                                            「{theirToday.note}」
                                        </span>
                                    )}
                                </span>
                            </p>
                        ) : (
                            <p className="m-0 text-sm text-ink-muted">还没记今天的。</p>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
}
