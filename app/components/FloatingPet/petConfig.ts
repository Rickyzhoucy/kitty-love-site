export const PET_ASSETS = [
    { id: 'kitty', name: 'Kitty', emoji: '🐱' },
    { id: 'momo', name: 'Momo', emoji: '🐈' },
    { id: 'hello-kitty', name: 'Hello Kitty', emoji: '🎀' },
    { id: 'snoopy', name: 'Snoopy', emoji: '🐶' },
    { id: 'shiba', name: '柴犬', emoji: '🐕' },
    { id: 'bichon', name: '比熊', emoji: '🐩' },
] as const;

export type PetAssetId = typeof PET_ASSETS[number]['id'];

export interface PetState {
    id: string;
    name: string;
    assetId: PetAssetId | null;
    createdAt: string;
    updatedAt: string;
}
