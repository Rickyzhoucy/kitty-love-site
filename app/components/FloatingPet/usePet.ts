'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPet, invalidatePetCache, updatePet } from '@/lib/api/pet';
import { subscribeServerEvent, type ResourceChangedEvent } from '@/lib/api/events';
import type { PetAssetId, PetState } from './petConfig';

interface UsePetReturn {
    pet: PetState | null;
    loading: boolean;
    error: string | null;
    rename: (name: string) => Promise<boolean>;
    setAssetId: (assetId: PetAssetId) => Promise<boolean>;
    refetch: () => Promise<void>;
}

export function usePet(skip = false): UsePetReturn {
    const [pet, setPet] = useState<PetState | null>(null);
    const [loading, setLoading] = useState(!skip);
    const [error, setError] = useState<string | null>(null);

    const fetchPet = useCallback(async () => {
        if (skip) return;
        try {
            setPet(await getPet(true));
            setError(null);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '宠物状态加载失败');
        } finally {
            setLoading(false);
        }
    }, [skip]);

    useEffect(() => {
        void fetchPet();
    }, [fetchPet]);

    /**
     * 别处改了名字/形象，这边立刻跟上。
     *
     * 一个人常常同时开着网页、Tauri 主窗口和桌宠窗口，三个各是独立的 JS 环境。
     * 以前只有动手改的那个窗口会变，其余的要重启才更新——现象就是「改完名字，
     * 桌宠还叫原来那个」。服务端在 PATCH /pet 时广播 `resource.changed`，
     * 这里收到就作废缓存重拉。
     */
    useEffect(() => {
        if (skip) return;
        return subscribeServerEvent<ResourceChangedEvent>('resource.changed', event => {
            if (event.resource !== 'pet') return;
            invalidatePetCache();
            void fetchPet();
        });
    }, [fetchPet, skip]);

    const patchPet = async (values: Partial<Pick<PetState, 'name' | 'assetId'>>) => {
        try {
            setPet(await updatePet(values));
            return true;
        } catch {
            return false;
        }
    };

    return {
        pet,
        loading,
        error,
        rename: name => patchPet({ name }),
        setAssetId: assetId => patchPet({ assetId }),
        refetch: fetchPet,
    };
}
