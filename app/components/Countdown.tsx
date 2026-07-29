"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CountdownProps {
    startDate: string;
    title: string;
    type?: 'countup' | 'countdown';
    onDelete?: () => void;
}

export default function Countdown({ startDate, title, type = 'countup', onDelete }: CountdownProps) {
    const [timeElapsed, setTimeElapsed] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    const [isExpired, setIsExpired] = useState(false);

    useEffect(() => {
        const calculateTimeElapsed = () => {
            const date = new Date(startDate);
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

            <div className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-muted">
                <Heart size={11} className="text-accent" fill="currentColor" />
                <span className={cn('truncate', isExpired && 'line-through')}>{title}</span>
                {onDelete && isExpired && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="ml-auto text-ink-muted hover:text-danger transition-colors cursor-pointer"
                        title="删除计时器"
                        aria-label={`删除计时器 ${title}`}
                    >
                        ✕
                    </button>
                )}
            </div>

            <div className={cn('relative mt-3 flex items-baseline gap-2', isExpired && 'opacity-50')}>
                <span className="font-display text-6xl font-semibold leading-none text-accent tabular-nums">
                    {timeElapsed.days}
                </span>
                <span className="text-sm tracking-widest text-ink-muted">天</span>
            </div>

            <div className={cn('relative mt-2 font-mono text-sm tabular-nums text-ink-muted', isExpired && 'opacity-50')}>
                {pad(timeElapsed.hours)}:{pad(timeElapsed.minutes)}:{pad(timeElapsed.seconds)}
            </div>
        </motion.div>
    );
}
