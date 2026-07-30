export const PET_ASSETS = [
    { id: 'kitty', name: 'Kitty', emoji: '🐱', renderer: 'frames' },
    { id: 'momo', name: 'Momo', emoji: '🐈', renderer: 'frames' },
    { id: 'hello-kitty', name: 'Hello Kitty', emoji: '🎀', renderer: 'frames' },
    { id: 'snoopy', name: 'Snoopy', emoji: '🐶', renderer: 'frames' },
    {
        id: 'shiba',
        name: '柴犬',
        emoji: '🐕',
        renderer: 'rive',
        artboard: 'ShibaPet',
        source: '/pet-assets/shiba/v2/shiba-canonical-v6.riv',
    },
    {
        id: 'bichon',
        name: '比熊',
        emoji: '🐩',
        renderer: 'rive',
        artboard: 'BichonPet',
        source: '/pet-assets/bichon/v2/bichon-canonical-v6.riv',
    },
] as const;

export type PetAssetId = typeof PET_ASSETS[number]['id'];
export type PetAsset = typeof PET_ASSETS[number];

export function getPetAsset(assetId: string): PetAsset | undefined {
    return PET_ASSETS.find(asset => asset.id === assetId);
}

export interface PetState {
    id: string;
    name: string;
    assetId: PetAssetId | null;
    createdAt: string;
    updatedAt: string;
}
