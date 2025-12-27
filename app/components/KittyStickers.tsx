"use client";

import { useEffect, useState } from 'react';
import styles from './KittyStickers.module.css';

// Hello Kitty 风格的可爱贴纸
const STICKERS = ['🎀', '🌸', '⭐', '💖', '🍓', '🌈', '✨', '🦋', '🍰', '🎵', '💕', '🌷'];

interface StickerData {
    id: number;
    emoji: string;
    x: number;
    y: number;
    size: number;
    delay: number;
    duration: number;
}

interface KittyStickersProps {
    count?: number;
}

export default function KittyStickers({ count = 10 }: KittyStickersProps) {
    const [stickers, setStickers] = useState<StickerData[]>([]);

    useEffect(() => {
        const generated: StickerData[] = [];
        for (let i = 0; i < count; i++) {
            generated.push({
                id: i,
                emoji: STICKERS[Math.floor(Math.random() * STICKERS.length)],
                x: Math.random() * 90 + 5, // 5-95%，避免贴边
                y: Math.random() * 85 + 5, // 5-90%，避免太靠底部
                size: 1 + Math.random() * 1, // 1-2rem
                delay: Math.random() * 2,
                duration: 4 + Math.random() * 3, // 4-7s
            });
        }
        setStickers(generated);
    }, [count]);

    return (
        <div className={styles.container}>
            {stickers.map((sticker) => (
                <div
                    key={sticker.id}
                    className={styles.sticker}
                    style={{
                        left: `${sticker.x}%`,
                        top: `${sticker.y}%`,
                        fontSize: `${sticker.size}rem`,
                        animationDelay: `${sticker.delay}s`,
                        animationDuration: `${sticker.duration}s`,
                    }}
                >
                    {sticker.emoji}
                </div>
            ))}
        </div>
    );
}
