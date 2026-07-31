/**
 * 素材**自身**朝哪边。
 *
 * 这个字段必须逐个素材声明，不能有全局默认值：两套素材的朝向本来就是相反的
 * ——帧序列（Kitty / Momo / Hello Kitty / Snoopy）画的是朝右，Rive 那两只狗
 * 绑的是朝左。渲染层据此决定要不要镜像（见 PetBodyRenderer），漏填或填错的
 * 表现是「往左走却面朝右」，而且只在那一个素材上出现。
 *
 * 加新素材时先看一眼原图朝哪边，别照抄上一行。
 */
export const PET_ASSETS = [
    { id: 'kitty', name: 'Kitty', emoji: '🐱', renderer: 'frames', sourceFacing: 'right' },
    { id: 'momo', name: 'Momo', emoji: '🐈', renderer: 'frames', sourceFacing: 'right' },
    { id: 'hello-kitty', name: 'Hello Kitty', emoji: '🎀', renderer: 'frames', sourceFacing: 'right' },
    { id: 'snoopy', name: 'Snoopy', emoji: '🐶', renderer: 'frames', sourceFacing: 'right' },
    {
        id: 'shiba',
        name: '柴犬',
        emoji: '🐕',
        renderer: 'rive',
        artboard: 'ShibaPet',
        source: '/pet-assets/shiba/v2/shiba-canonical-v6.riv',
        sourceFacing: 'left',
    },
    {
        id: 'bichon',
        name: '比熊',
        emoji: '🐩',
        renderer: 'rive',
        artboard: 'BichonPet',
        source: '/pet-assets/bichon/v2/bichon-canonical-v6.riv',
        sourceFacing: 'left',
    },
    // 插画版的同两只狗。**是新增，不是替换**——上面那两只照片风的还在，
    // 两种画风各留一份，选哪只是他们的事。
    //
    // 这两份素材不是手绑的骨骼，而是从 H3 生成的「原地踏步」视频里抽的帧
    // （见 scripts/walk-video-to-frames.py）。走这条路是因为手绑一只狗要标
    // 几十个关节多边形，而视频能直接给出画风一致的步态循环；代价是没有
    // v6 那套的 29 个动作，只有 idle 和 walk，够这个体型看了。
    {
        id: 'shiba-q',
        name: '柴犬（插画）',
        emoji: '🐕',
        renderer: 'frames',
        sourceFacing: 'left',
    },
    {
        id: 'bichon-q',
        name: '比熊（插画）',
        emoji: '🐩',
        renderer: 'frames',
        sourceFacing: 'left',
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
