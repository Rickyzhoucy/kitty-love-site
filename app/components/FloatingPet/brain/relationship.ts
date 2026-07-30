/**
 * 关系状态。跨会话累积，是「宠物认不认识你」的唯一真相。
 *
 * P1 阶段存在 localStorage，P3 迁移到 CompanionPetProfile / CompanionPetState。
 */
export interface PetRelationship {
    /** 熟悉度 0..1，由累计互动次数驱动，只增不减 */
    familiarity: number;
    /** 信任度 0..1，正向互动增、惊吓减 */
    trust: number;
    /** 由 familiarity 阶梯映射出的整数等级，用于对外展示 */
    level: number;
    lastInteractionAt: number;
    /** 当天互动次数，跨日自动归零 */
    dailyInteractionCount: number;
    /** 记录 dailyInteractionCount 所属的日期，格式 YYYY-MM-DD */
    dailyCountDate: string;
}

export const INITIAL_RELATIONSHIP: PetRelationship = {
    familiarity: 0,
    trust: 0.35,
    level: 1,
    lastInteractionAt: 0,
    dailyInteractionCount: 0,
    dailyCountDate: '',
};

/** familiarity 到等级的阶梯。索引即等级下标，值为进入该等级所需的熟悉度。 */
const LEVEL_THRESHOLDS = [0, 0.08, 0.2, 0.36, 0.55, 0.75, 0.9];

export function relationshipLevel(familiarity: number): number {
    let level = 1;
    for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
        if (familiarity >= LEVEL_THRESHOLDS[index]) level = index + 1;
    }
    return level;
}

export type InteractionKind =
    | 'pet'        // 摸头 / 摸身体
    | 'play'
    | 'feed'
    | 'chat'
    | 'drag'       // 抱起移动，中性偏正
    | 'startle';   // 摔落等负向事件

/** 每种互动对熟悉度和信任度的贡献。 */
const INTERACTION_WEIGHT: Record<InteractionKind, { familiarity: number; trust: number }> = {
    pet: { familiarity: 0.012, trust: 0.02 },
    play: { familiarity: 0.016, trust: 0.025 },
    feed: { familiarity: 0.014, trust: 0.03 },
    chat: { familiarity: 0.02, trust: 0.015 },
    drag: { familiarity: 0.004, trust: 0.002 },
    startle: { familiarity: 0.002, trust: -0.06 },
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const dateKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export function registerInteraction(
    relationship: PetRelationship,
    kind: InteractionKind,
    now: number,
): PetRelationship {
    const weight = INTERACTION_WEIGHT[kind];
    const today = dateKey(now);
    const sameDay = relationship.dailyCountDate === today;
    const dailyCount = sameDay ? relationship.dailyInteractionCount + 1 : 1;

    // 当天互动越多，单次贡献越小——递减回报，防止刷熟悉度
    const fatigue = 1 / (1 + dailyCount * 0.06);
    const familiarity = clamp(relationship.familiarity + weight.familiarity * fatigue);

    return {
        familiarity,
        trust: clamp(relationship.trust + weight.trust * (weight.trust > 0 ? fatigue : 1)),
        level: relationshipLevel(familiarity),
        lastInteractionAt: now,
        dailyInteractionCount: dailyCount,
        dailyCountDate: today,
    };
}

/**
 * 关系对自主行为的门槛系数。
 *
 * 生疏的宠物不会主动求抱，但会好奇地观察；熟悉之后才敢主动靠近。
 * 返回 0..1，用作目标评分的 relationshipFactor。
 */
export function relationshipFactor(
    relationship: PetRelationship,
    requires: 'none' | 'familiar' | 'trusted',
): number {
    if (requires === 'none') return 1;
    if (requires === 'familiar') return 0.25 + relationship.familiarity * 0.75;
    return 0.1 + relationship.trust * 0.9;
}

/** 跨日时归零当天计数，不改变长期值。 */
export function rolloverDaily(
    relationship: PetRelationship,
    now: number,
): PetRelationship {
    const today = dateKey(now);
    if (relationship.dailyCountDate === today) return relationship;
    return { ...relationship, dailyInteractionCount: 0, dailyCountDate: today };
}
