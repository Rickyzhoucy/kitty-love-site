'use client';

import { useState, useEffect, useCallback } from 'react';
import { PetState, PET_CONFIG } from './petConfig';

interface UsePetReturn {
    pet: PetState | null;
    loading: boolean;
    error: string | null;
    feed: () => Promise<{ success: boolean; message?: string; expGained?: number }>;
    play: () => Promise<{ success: boolean; message?: string; expGained?: number }>;
    rename: (name: string) => Promise<boolean>;
    changeColor: (color: string) => Promise<boolean>;
    setCustomSprite: (url: string | null) => Promise<boolean>;
    equipItem: (slot: string, itemId: string) => Promise<boolean>;
    refetch: () => Promise<void>;
}

export function usePet(): UsePetReturn {
    const [pet, setPet] = useState<PetState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchPet = useCallback(async () => {
        try {
            const res = await fetch('/api/pet');
            if (res.status === 401) {
                // 如果 API 返回 401，说明 Session 失效，跳转验证
                window.location.href = '/verify?redirect=/';
                return;
            }
            if (!res.ok) throw new Error('Failed to fetch pet');
            const data = await res.json();
            setPet(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPet();

        // 每分钟刷新一次状态
        const interval = setInterval(fetchPet, 60000);
        return () => clearInterval(interval);
    }, [fetchPet]);

    const performAction = async (action: string, data?: Record<string, unknown>) => {
        try {
            const res = await fetch('/api/pet', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...data })
            });

            const result = await res.json();

            if (!res.ok) {
                return { success: false, message: result.error, limited: result.limited };
            }

            setPet(result.pet);
            return {
                success: true,
                expGained: result.expGained,
                leveledUp: result.leveledUp,
                evolved: result.evolved
            };
        } catch {
            return { success: false, message: 'Network error' };
        }
    };

    const feed = async () => {
        const result = await performAction('feed');
        return result;
    };

    const play = async () => {
        const result = await performAction('play');
        return result;
    };

    const rename = async (name: string) => {
        const result = await performAction('rename', { name });
        return result.success;
    };

    const changeColor = async (color: string) => {
        const result = await performAction('changeColor', { color });
        return result.success;
    };

    const setCustomSprite = async (url: string | null) => {
        const result = await performAction('customSprite', { customSprite: url });
        return result.success;
    };

    const equipItem = async (slot: string, itemId: string) => {
        if (!pet) return false;
        const newEquipped = { ...pet.equippedItems, [slot]: itemId };
        const result = await performAction('equip', { equippedItems: newEquipped });
        return result.success;
    };

    return {
        pet,
        loading,
        error,
        feed,
        play,
        rename,
        changeColor,
        setCustomSprite,
        equipItem,
        refetch: fetchPet
    };
}
