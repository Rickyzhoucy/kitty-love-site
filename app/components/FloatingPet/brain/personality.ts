/**
 * 性格特质。出生时确定，长期不变。
 *
 * 每项取值 0..1。特质不直接决定行为，而是作为需求衰减率和目标评分的偏置，
 * 让两只需求数值相同的宠物做出不同选择。
 */
export interface PetTraits {
    /** 精力旺盛度：影响 energy 衰减速度与动作频率 */
    energetic: number;
    /** 黏人度：影响 affection 衰减速度与求关注的触发阈值 */
    clingy: number;
    /** 好奇心：影响 curiosity 增长与探索倾向 */
    curious: number;
    /** 胆小度：影响 stress 增长与惊吓反射强度 */
    timid: number;
    /** 顽皮度：影响 play 目标的基础权重 */
    playful: number;
}

export const DEFAULT_TRAITS: PetTraits = {
    energetic: 0.5,
    clingy: 0.5,
    curious: 0.5,
    timid: 0.5,
    playful: 0.5,
};

const TRAIT_KEYS = [
    'energetic',
    'clingy',
    'curious',
    'timid',
    'playful',
] as const satisfies readonly (keyof PetTraits)[];

/** FNV-1a，用于把任意字符串摊成稳定的 32 位整数。 */
function hashSeed(seed: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** xorshift32，从单个种子展开成一串可重复的伪随机数。 */
function nextRandom(state: number): { value: number; state: number } {
    let next = state;
    next ^= next << 13;
    next >>>= 0;
    next ^= next >>> 17;
    next ^= next << 5;
    next >>>= 0;
    return { value: next / 0x100000000, state: next };
}

/**
 * 从宠物标识确定性地派生性格。
 *
 * 同一只宠物在任何设备、任何会话都得到同一套特质，因此在 P3 落库之前
 * 就能拿到稳定的性格差异，而不需要先建表。落库后改为读取持久化值，
 * 本函数退化为新宠物的初始值来源。
 */
export function traitsFromSeed(seed: string): PetTraits {
    let state = hashSeed(seed) || 1;
    const traits = { ...DEFAULT_TRAITS };
    for (const key of TRAIT_KEYS) {
        const step = nextRandom(state);
        state = step.state;
        // 收敛到 0.2..0.8，避免出现完全不动或完全躁动的极端个体
        traits[key] = Math.round((0.2 + step.value * 0.6) * 100) / 100;
    }
    return traits;
}
