'use client';

import { api } from './client';

/**
 * 行为脑快照的服务端契约（架构文档 §11 / 实施计划 §6.2）。
 *
 * 服务端不解释这些内容，它只做两件事：存快照，以及把「离开了多久」夹到上限。
 * 真正的衰减计算留在 `brain/needs.ts` 的 `settleElapsed`——把那套公式在
 * Python 里再写一遍，等于让同一个物理模型有两份实现，它们一定会漂。
 */
export interface PetStateSnapshot {
    companionId: string;
    traits: Record<string, number>;
    needs: Record<string, number> | null;
    mood: Record<string, unknown> | null;
    relationship: Record<string, unknown> | null;
    activeGoal: string;
    /** 距上次结算的秒数，**已被服务端夹到 cappedAt** */
    elapsedSeconds: number;
    cappedAt: number;
}

export interface PetStateWrite {
    needs: Record<string, number>;
    mood: Record<string, unknown>;
    relationship: Record<string, unknown>;
    activeGoal: string;
    traits: Record<string, number>;
}

export function fetchPetState(): Promise<PetStateSnapshot> {
    return api.get<PetStateSnapshot>('/pet/state');
}

export function savePetState(state: PetStateWrite): Promise<PetStateSnapshot> {
    return api.put<PetStateSnapshot>('/pet/state', state);
}
