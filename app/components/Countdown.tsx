"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import styles from './Countdown.module.css';

interface CountdownProps {
    targetDate: string; // YYYY-MM-DD
    title: string;
}

export default function Countdown({ targetDate, title }: CountdownProps) {
    const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);

    useEffect(() => {
        const calculateTimeLeft = () => {
            const difference = +new Date(targetDate) - +new Date();

            let diff = difference;

            if (difference < 0) {
                // Handle past dates if needed, or loop annually
                // For now, if passed, just show 0 or handle externally
                if (difference < -86400000) { // If more than a day passed
                    // Logic to find next year's date could go here
                }
            }

            if (diff > 0) {
                setTimeLeft({
                    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((diff / 1000 / 60) % 60),
                    seconds: Math.floor((diff / 1000) % 60),
                });
            } else {
                setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
            }
        };

        calculateTimeLeft();
        const timer = setInterval(calculateTimeLeft, 1000);

        return () => clearInterval(timer);
    }, [targetDate]);

    if (!timeLeft) return null;

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
        >
            <div className={styles.header}>
                <Clock size={16} />
                <span>{title}</span>
            </div>
            <div className={styles.timer}>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeLeft.days}</span>
                    <span className={styles.label}>天</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeLeft.hours}</span>
                    <span className={styles.label}>时</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeLeft.minutes}</span>
                    <span className={styles.label}>分</span>
                </div>
                <div className={styles.unit}>
                    <span className={styles.value}>{timeLeft.seconds}</span>
                    <span className={styles.label}>秒</span>
                </div>
            </div>
        </motion.div>
    );
}
