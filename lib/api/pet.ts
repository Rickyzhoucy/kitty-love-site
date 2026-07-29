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
