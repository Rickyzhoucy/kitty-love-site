"use client";

import { useEffect, useState, useMemo } from 'react';
import styles from './ParticleBackground.module.css';

interface Particle {
    id: number;
    type: 'heart' | 'star' | 'sparkle' | 'petal';
    x: number;
    delay: number;
    duration: number;
    size: number;
}

interface ParticleBackgroundProps {
    particleCount?: number;
    types?: ('heart' | 'star' | 'sparkle' | 'petal')[];
}

const PARTICLE_EMOJIS = {
    heart: '💗',
    star: '⭐',
    sparkle: '✨',
    petal: '🌸',
};

const DEFAULT_TYPES: ('heart' | 'star' | 'sparkle' | 'petal')[] = ['heart', 'star', 'sparkle', 'petal'];

export default function ParticleBackground({
    particleCount = 20,
    types = DEFAULT_TYPES
}: ParticleBackgroundProps) {
    const [particles, setParticles] = useState<Particle[]>([]);

    // 将 types 数组序列化为字符串以保持稳定的依赖项
    const typesKey = useMemo(() => types.join(','), [types]);

    useEffect(() => {
        const typeArray = typesKey.split(',') as ('heart' | 'star' | 'sparkle' | 'petal')[];
        const generated: Particle[] = [];
        for (let i = 0; i < particleCount; i++) {
            const type = typeArray[Math.floor(Math.random() * typeArray.length)];
            generated.push({
                id: i,
                type,
                x: Math.random() * 100,
                delay: Math.random() * 15,
                duration: 10 + Math.random() * 15,
                size: 0.6 + Math.random() * 0.8,
            });
        }
        setParticles(generated);
    }, [particleCount, typesKey]);

    return (
        <div className={styles.container}>
            {particles.map((particle) => (
                <div
                    key={particle.id}
                    className={`${styles.particle} ${styles[particle.type]}`}
                    style={{
                        left: `${particle.x}%`,
                        animationDelay: `${particle.delay}s`,
                        animationDuration: `${particle.duration}s`,
                        fontSize: `${particle.size}rem`,
                    }}
                >
                    {PARTICLE_EMOJIS[particle.type]}
                </div>
            ))}
        </div>
    );
}
