'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 宠物显示尺寸。
 *
 * 存的是**倍率**而不是像素：基准尺寸本身要随屏幕变（桌面 138px、手机 106px），
 * 存死像素会让用户在电脑上调好的大小，到手机上变成占半个屏幕。
 * 基准由 CSS 的媒体查询给，这里只乘一个系数。
 */
export type PetSizeId = 'small' | 'normal' | 'large' | 'huge';

export interface PetSizeOption {
    id: PetSizeId;
    label: string;
    scale: number;
}

export const PET_SIZES: PetSizeOption[] = [
    { id: 'small', label: '小', scale: 0.72 },
    { id: 'normal', label: '标准', scale: 1 },
    { id: 'large', label: '大', scale: 1.35 },
    { id: 'huge', label: '特大', scale: 1.75 },
];

const STORAGE_KEY = 'companionPetSize';
const DEFAULT_SIZE: PetSizeId = 'normal';

function isPetSizeId(value: unknown): value is PetSizeId {
    return PET_SIZES.some(option => option.id === value);
}

export function scaleOf(size: PetSizeId): number {
    return PET_SIZES.find(option => option.id === size)?.scale ?? 1;
}

/**
 * localStorage 作为外部数据源接进 React。
 *
 * 用 `useSyncExternalStore` 而不是「useState + useEffect 里读一次」：后者会在
 * 挂载后再触发一次渲染（React 的 set-state-in-effect 规则正是拦这个），而且
 * 拿不到跨标签页的变更。这里顺带得到了后者——在另一个标签页调了大小，
 * 这边会跟着变。
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    // storage 事件只在**其它**标签页写入时触发，同页的变更靠 listeners 手动广播。
    window.addEventListener('storage', onChange);
    return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onChange);
    };
}

function readSize(): PetSizeId {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return isPetSizeId(saved) ? saved : DEFAULT_SIZE;
    } catch {
        return DEFAULT_SIZE;
    }
}

// 服务端没有 localStorage，一律按默认值渲染，避免 hydration 不一致。
const readServerSize = (): PetSizeId => DEFAULT_SIZE;

export function usePetSize() {
    const size = useSyncExternalStore(subscribe, readSize, readServerSize);

    const setSize = useCallback((next: PetSizeId) => {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // 隐私模式下写不进去。这时 readSize 会一直返回默认值，
            // 尺寸调不动——比假装成功、刷新后又变回去要诚实。
        }
        listeners.forEach(notify => notify());
    }, []);

    return { size, setSize, scale: scaleOf(size) };
}
