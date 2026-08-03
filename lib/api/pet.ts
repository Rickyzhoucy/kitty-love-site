import type { PetState } from '@/app/components/FloatingPet/petConfig';
import { api } from './client';

let cachedPet: PetState | null = null;
let pendingPet: Promise<PetState> | null = null;

export function getPet(fresh = false): Promise<PetState> {
    if (!fresh && cachedPet) return Promise.resolve(cachedPet);
    if (!fresh && pendingPet) return pendingPet;
    pendingPet = api.get<PetState>('/pet')
        .then(pet => {
            cachedPet = pet;
            return pet;
        })
        .finally(() => {
            pendingPet = null;
        });
    return pendingPet;
}

export async function updatePet(values: Partial<PetState>): Promise<PetState> {
    const pet = await api.patch<PetState>('/pet', values);
    cachedPet = pet;
    return pet;
}

/**
 * 丢掉这份模块级缓存。
 *
 * 改名字/换形象是**跨窗口**的事：桌宠窗口、Tauri 主窗口和网页各是一个
 * JS 环境，各有一份 `cachedPet`。动手改的那个窗口会顺手更新自己那份，
 * 其余窗口的那份会一直停在旧值上，直到重启——所以收到广播时必须主动作废，
 * 否则接下来的 `getPet()` 还是拿旧名字。
 */
export function invalidatePetCache(): void {
    cachedPet = null;
    pendingPet = null;
}
