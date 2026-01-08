"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import styles from './Countdown.module.css';

interface CountdownProps {
    startDate: string; // YYYY-MM-DD
    title: string;
    type?: 'countup' | 'countdown';
    onDelete?: () => void;
}

export default function Countdown({ startDate, title, type = 'countup', onDelete }: CountdownProps) {
    const [timeElapsed, setTimeElapsed] = useState<{ days: number; hours: number; minutes: number; seconds: number }>({
        days: 0, hours: 0, minutes: 0, seconds: 0
    });
    const [isExpired, setIsExpired] = useState(false);

    useEffect(() => {
        const calculateTimeElapsed = () => {
            const date = new Date(startDate);
            const now = new Date();
            let difference = 0;

            if (type === 'countup') {
                difference = now.getTime() - date.getTime();
            } else {
                difference = date.getTime() - now.getTime();
            }

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
                // Only mark as expired for countdowns
                if (type === 'countdown') {
                    setIsExpired(true);
                }
            }
        };

        calculateTimeElapsed();
        const timer = setInterval(calculateTimeElapsed, 1000);

        return () => clearInterval(timer);
    }, [startDate, type]);

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            style={isExpired ? { opacity: 0.7 } : undefined}
        >
            <div className={styles.header}>
                <Heart size={16} fill="#F48FB1" color="#F48FB1" />
                <span style={isExpired ? { textDecoration: 'line-through', color: '#888' } : undefined}>
                    {title}
                </span>
                {onDelete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        style={{
                            marginLeft: 'auto', background: 'none', border: 'none',
                            cursor: 'pointer', opacity: 0.6, padding: 0, display: 'flex'
                        }}
                        title="删除计时器"
                    >
                        <span style={{ fontSize: '14px' }}>✕</span>
                    </button>
                )}
            </div>
            <div className={styles.timer} style={isExpired ? { opacity: 0.5 } : undefined}>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeElapsed.days}</span>
                    <span className={styles.label}>天</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeElapsed.hours}</span>
                    <span className={styles.label}>时</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeElapsed.minutes}</span>
                    <span className={styles.label}>分</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeElapsed.seconds}</span>
                    <span className={styles.label}>秒</span>
                </div>
            </div>
        </motion.div>
    );
}
