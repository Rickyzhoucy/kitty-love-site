'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPet, updatePet } from '@/lib/api/pet';
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
