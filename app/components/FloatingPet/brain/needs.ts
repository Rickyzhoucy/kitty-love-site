import type { PetTraits } from './personality';

/**
 * 六项需求，取值 0..1。
 *
 * 除 energy 外，数值越大表示该需求越紧迫。energy 相反：1 表示精力充沛，
 * 0 表示困倦。这样命名是为了让「精力」在 UI 上读起来符合直觉，
 * 评分时由 needUrgency 统一取补。
 */
export interface PetNeeds {
    hunger: number;
    energy: number;
    affection: number;
    boredom: number;
    curiosity: number;
    stress: number;
}

export const INITIAL_NEEDS: PetNeeds = {
    hunger: 0.15,
    energy: 0.85,
    affection: 0.3,
    boredom: 0.2,
    curiosity: 0.35,
    stress: 0.05,
};

/**
 * 基准速率，单位 1/秒，对应中性性格（各特质 0.5）。
 * 注释里的时长是从一端走到另一端所需的大致时间。
 */
const RATE = {
    hunger: 1 / 2_400,      // 约 40 分钟饿透
    energy: 1 / 3_000,      // 约 50 分钟耗尽精力
    energyRecovery: 1 / 600, // 睡觉时约 10 分钟回满
    affection: 1 / 1_500,   // 约 25 分钟从满足到渴望关注
    boredom: 1 / 900,       // 约 15 分钟无聊透顶
    curiosity: 1 / 1_800,
    stressDecay: 1 / 240,   // 约 4 分钟平复
} as const;

/** 单次 tick 的外部上下文。 */
export interface NeedsContext {
    /** 用户近期是否在页面上活动 */
    userActive: boolean;
    /** 宠物当前是否在睡觉 */
    sleeping: boolean;
    /** 页面是否刚刚发生导航 */
    pageChanged: boolean;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 推进需求。dt 单位为秒。
 *
 * 性格在这里第一次介入：精力旺盛的宠物掉精力更快但更耐饿，黏人的宠物
 * 更快开始想念用户，胆小的宠物压力涨得快。这是「同样的输入、不同的行为」
 * 的根源，而不是在评分阶段才做区分。
 */
export function decayNeeds(
    needs: PetNeeds,
    traits: PetTraits,
    dt: number,
    context: NeedsContext,
): PetNeeds {
    const next = { ...needs };

    next.hunger = clamp(next.hunger + RATE.hunger * dt * (1.5 - traits.energetic * 0.5));

    if (context.sleeping) {
        next.energy = clamp(next.energy + RATE.energyRecovery * dt);
    } else {
        next.energy = clamp(next.energy - RATE.energy * dt * (0.5 + traits.energetic));
    }

    next.affection = clamp(next.affection + RATE.affection * dt * (0.5 + traits.clingy));

    // 用户在场时无聊涨得慢——有人陪着本身就是消遣
    const boredomScale = context.userActive ? 0.4 : 1;
    next.boredom = context.sleeping
        ? clamp(next.boredom - RATE.boredom * dt)
        : clamp(next.boredom + RATE.boredom * dt * (0.5 + traits.playful) * boredomScale);

    next.curiosity = clamp(
        next.curiosity + RATE.curiosity * dt * (0.5 + traits.curious)
        + (context.pageChanged ? 0.25 * traits.curious : 0),
    );

    next.stress = clamp(next.stress - RATE.stressDecay * dt * (1.5 - traits.timid * 0.5));

    return next;
}

/** 需求被满足时的即时回落。 */
export type NeedRelief =
    | 'fed'
    | 'played'
    | 'petted'
    | 'explored'
    | 'rested'
    | 'startled';

export function relieveNeed(needs: PetNeeds, relief: NeedRelief, traits: PetTraits): PetNeeds {
    const next = { ...needs };
    switch (relief) {
        case 'fed':
            next.hunger = clamp(next.hunger - 0.5);
            break;
        case 'played':
            next.boredom = clamp(next.boredom - 0.28);
            next.energy = clamp(next.energy - 0.08);
            next.affection = clamp(next.affection - 0.2);
            break;
        case 'petted':
            next.affection = clamp(next.affection - 0.35);
            next.stress = clamp(next.stress - 0.25);
            break;
        case 'explored':
            next.curiosity = clamp(next.curiosity - 0.24);
            next.boredom = clamp(next.boredom - 0.2);
            break;
        case 'rested':
            next.energy = clamp(next.energy + 0.35);
            break;
        case 'startled':
            // 胆小的宠物受惊更重
            next.stress = clamp(next.stress + 0.2 + traits.timid * 0.3);
            break;
    }
    return next;
}

/**
 * 把需求换算成 0..1 的紧迫度。energy 在这里取补，使得「精力低」和
 * 「饥饿高」在评分中是同向的。
 */
export function urgency(needs: PetNeeds): Record<keyof PetNeeds, number> {
    return {
        hunger: needs.hunger,
        energy: 1 - needs.energy,
        affection: needs.affection,
        boredom: needs.boredom,
        curiosity: needs.curiosity,
        stress: needs.stress,
    };
}

/**
 * 页面隐藏期间不 tick，恢复时一次性结算。
 * 上限 12 小时——离开一周回来不该看到一只濒死的宠物。
 */
export const MAX_CATCHUP_SECONDS = 12 * 60 * 60;

export function settleElapsed(
    needs: PetNeeds,
    traits: PetTraits,
    elapsedSeconds: number,
    context: NeedsContext,
): PetNeeds {
    const capped = Math.min(elapsedSeconds, MAX_CATCHUP_SECONDS);
    if (capped <= 0) return needs;
    // 分段推进，避免大 dt 让 clamp 吃掉非线性项
    const step = 60;
    let current = needs;
    let remaining = capped;
    while (remaining > 0) {
        const slice = Math.min(step, remaining);
        current = decayNeeds(current, traits, slice, context);
        remaining -= slice;
    }
    return current;
}
