"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import styles from './Countdown.module.css';

interface CountdownProps {
    startDate: string; // YYYY-MM-DD - 在一起的日期
    title: string;
}

export default function Countdown({ startDate, title }: CountdownProps) {
    const [timeElapsed, setTimeElapsed] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);

    useEffect(() => {
        const calculateTimeElapsed = () => {
            const start = new Date(startDate);
            const now = new Date();
            const difference = now.getTime() - start.getTime();

            if (difference > 0) {
                setTimeElapsed({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60),
                });
            } else {
                setTimeElapsed({ days: 0, hours: 0, minutes: 0, seconds: 0 });
            }
        };

        calculateTimeElapsed();
        const timer = setInterval(calculateTimeElapsed, 1000);

        return () => clearInterval(timer);
    }, [startDate]);

    if (!timeElapsed) return null;

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
        >
            <div className={styles.header}>
                <Heart size={16} fill="#F48FB1" color="#F48FB1" />
                <span>{title}</span>
            </div>
            <div className={styles.timer}>
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
