"use client";

import { useEffect, useState } from 'react';
import styles from './FloatingHearts.module.css';

export default function FloatingHearts() {
    const [hearts, setHearts] = useState<number[]>([]);

    useEffect(() => {
        // Generate static hearts on mount to avoid hydration mismatch
        const initialHearts = Array.from({ length: 15 }, (_, i) => i);
        setHearts(initialHearts);
    }, []);

    return (
        <div className={styles.container}>
            {hearts.map((i) => (
                <div
                    key={i}
                    className={styles.heart}
                    style={{
                        left: `${Math.random() * 100}vw`,
                        animationDelay: `${Math.random() * 5}s`,
                        animationDuration: `${10 + Math.random() * 10}s`,
                        opacity: 0.3 + Math.random() * 0.5,
                        transform: `scale(${0.5 + Math.random() * 1})`
                    }}
                >
                    ❤️
                </div>
            ))}
        </div>
    );
}
