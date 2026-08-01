"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseLocalDate } from '@/lib/date';

interface CountdownProps {
    startDate: string;
    title: string;
    type?: 'countup' | 'countdown';
    onDelete?: () => void;
    onEdit?: () => void;
}


export default function Countdown({ startDate, title, type = 'countup', onDelete, onEdit }: CountdownProps) {
    const [timeElapsed, setTimeElapsed] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    const [isExpired, setIsExpired] = useState(false);

    useEffect(() => {
        const calculateTimeElapsed = () => {
            const date = parseLocalDate(startDate);
            const now = new Date();
            const difference = type === 'countup'
                ? now.getTime() - date.getTime()
                : date.getTime() - now.getTime();

            if (difference > 0) {
                setTimeElapsed({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60),
                });
                setIsExpired(false);
            } else {
                setTimeElapsed({ days: 0, hours: 0, minutes: 0, seconds: 0 });
                if (type === 'countdown') setIsExpired(true);
            }
        };

        calculateTimeElapsed();
        const timer = setInterval(calculateTimeElapsed, 1000);
        return () => clearInterval(timer);
    }, [startDate, type]);

    const pad = (n: number) => String(n).padStart(2, '0');

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                'group relative flex w-[240px] shrink-0 snap-start flex-col overflow-hidden rounded-lg',
                'border border-ink/5 bg-surface px-6 py-5 shadow-soft transition-shadow hover:shadow-lift',
                isExpired && 'opacity-70'
            )}
        >
            {/* 巨型水印天数（背景装饰层） */}
            <span
                aria-hidden
                className="pointer-events-none absolute -right-3 -top-7 font-display text-[7rem] font-semibold leading-none text-accent/[0.07] select-none"
            >
                {timeElapsed.days}
            </span>

            {/* 改和删对所有卡片都给，不只是过期的那些。
                之前 delete 挂在 `isExpired` 上——纪念日基本都没过期，等于
                建好之后既改不了也删不了，只能去数据库里动手。 */}
            <div className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-muted">
                <Heart size={11} className="text-accent" fill="currentColor" />
                <span className={cn('truncate', isExpired && 'line-through')}>{title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                    {onEdit && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onEdit(); }}
                            className="rounded p-0.5 text-ink-muted transition-colors hover:text-accent cursor-pointer focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            title="编辑"
                            aria-label={`编辑纪念日 ${title}`}
                        >
                            <Pencil size={12} />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="rounded p-0.5 text-ink-muted transition-colors hover:text-danger cursor-pointer focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            title="删除"
                            aria-label={`删除纪念日 ${title}`}
                        >
                            <X size={12} />
                        </button>
                    )}
                </span>
            </div>

            <div className={cn('relative mt-3 flex items-baseline gap-2', isExpired && 'opacity-50')}>
                <span className="font-display text-6xl font-semibold leading-none text-accent tabular-nums">
                    {timeElapsed.days}
                </span>
                <span className="text-sm tracking-widest text-ink-muted">天</span>
            </div>

            {/* **这不是时刻，是「零头」**——整天之外还剩多少时分秒。
                不写单位的话它长得和墙上的钟一模一样，会被拿去和当前时间比，
                然后觉得「对不上」。加两个字就没这个歧义了。 */}
            <div className={cn('relative mt-2 flex items-baseline gap-1.5', isExpired && 'opacity-50')}>
                <span className="font-mono text-sm tabular-nums text-ink-muted">
                    {pad(timeElapsed.hours)}:{pad(timeElapsed.minutes)}:{pad(timeElapsed.seconds)}
                </span>
                <span className="text-[10px] tracking-wider text-ink-muted/70">时分秒</span>
            </div>
        </motion.div>
    );
}
