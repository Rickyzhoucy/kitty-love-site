import { urgency, type PetNeeds } from './needs';
import type { PetTraits } from './personality';
import { relationshipFactor, type PetRelationship } from './relationship';
import type {
    PetInitiative,
    PetPersistentActivity,
    PetReaction,
} from '../petBodyProtocol';

export type PetGoalId =
    | 'sleep'
    | 'rest'
    | 'seekAttention'
    | 'play'
    | 'explore'
    | 'eat'
    | 'observe'
    | 'idle';

export interface PetGoal {
    id: PetGoalId;
    activity: PetPersistentActivity;
    /** 目标达成时播放的一次性反应 */
    reaction?: PetReaction;
    /** 目标被选中后至少维持这么久，避免评分抖动导致的闪烁 */
    minDurationMs: number;
    /** 执行完后进入冷却，期间评分被压低 */
    cooldownMs: number;
}

export interface ScoredGoal extends PetGoal {
    score: number;
}

export interface GoalContext {
    userActive: boolean;
    documentHidden: boolean;
    /** 最近是否发生过页面导航 */
    recentPageChange: boolean;
    initiative: PetInitiative;
    /** 各目标上次执行完成的时间戳 */
    lastRunAt: Partial<Record<PetGoalId, number>>;
    now: number;
}

/**
 * 目标切换的滞回阈值。
 *
 * 效用每秒重算，若不设阈值，两个分数接近的目标会来回抖动。新目标必须
 * 高出当前目标这个幅度才允许切换。
 */
export const GOAL_SWITCH_MARGIN = 0.15;

/** 需求紧迫度超过此值时，该目标升入「生理和关系需求」优先级带。 */
export const NEED_PRIORITY_THRESHOLD = 0.65;

interface GoalDefinition extends PetGoal {
    /** 驱动该目标的需求；idle 类目标为 null */
    need: keyof PetNeeds | null;
    /** 基础权重，用于区分同等紧迫度下的目标偏好 */
    base: number;
    bias: (traits: PetTraits) => number;
    fit: (context: GoalContext) => number;
    requires: 'none' | 'familiar' | 'trusted';
}

const DEFINITIONS: GoalDefinition[] = [
    {
        id: 'sleep',
        activity: 'sleeping',
        // 睡觉靠 decayNeeds 的 sleeping 分支持续回精力，本身不需要完成回落，
        // 因此不设冷却——精力补够后 urgency 自然下降，目标会自己让位。
        minDurationMs: 60_000,
        cooldownMs: 0,
        need: 'energy',
        base: 1,
        bias: traits => 1.4 - traits.energetic * 0.9,
        // 用户在活动时不主动睡，页面隐藏时更容易睡
        fit: context => (context.documentHidden ? 1.4 : context.userActive ? 0.35 : 1),
        requires: 'none',
    },
    {
        // rest 与 sleep 消费同一个需求，靠「用户在不在」分流：主人还在旁边时
        // 不会真睡过去，只是趴下歇一会儿。改造前 rest 在每个维度上都被 sleep
        // 压制（同需求、更低 base、fit 恒为 1），从来没被选中过。
        id: 'rest',
        activity: 'idle',
        minDurationMs: 15_000,
        cooldownMs: 12_000,
        need: 'energy',
        base: 0.72,
        bias: traits => 1.3 - traits.energetic * 0.7,
        fit: context => (context.documentHidden ? 0.3 : context.userActive ? 1.5 : 0.7),
        requires: 'none',
    },
    {
        id: 'eat',
        activity: 'idle',
        reaction: 'eat',
        minDurationMs: 6_000,
        cooldownMs: 75_000,
        need: 'hunger',
        base: 0.95,
        bias: traits => 0.9 + traits.energetic * 0.2,
        fit: context => (context.documentHidden ? 0.2 : 1),
        requires: 'none',
    },
    {
        id: 'seekAttention',
        activity: 'walking',
        reaction: 'celebrate',
        minDurationMs: 8_000,
        cooldownMs: 40_000,
        need: 'affection',
        base: 0.9,
        bias: traits => 0.4 + traits.clingy * 1.4,
        // 只在用户还在页面上时才有意义
        fit: context => (context.userActive && !context.documentHidden ? 1.2 : 0.15),
        requires: 'familiar',
    },
    {
        id: 'play',
        activity: 'idle',
        reaction: 'play',
        minDurationMs: 12_000,
        cooldownMs: 25_000,
        need: 'boredom',
        base: 0.85,
        bias: traits => 0.4 + traits.playful * 1.4,
        fit: context => (context.documentHidden ? 0.1 : 1),
        requires: 'none',
    },
    // explore 与 observe 消费同一个需求（好奇心），靠 timid 分流：
    // 胆大的走过去看，胆小的原地观望。改造前 observe 在每个维度上都被
    // explore 压制，等于死代码，同时 timid 这个特质在行为上完全没有出口。
    {
        id: 'explore',
        activity: 'walking',
        minDurationMs: 15_000,
        cooldownMs: 20_000,
        need: 'curiosity',
        base: 0.8,
        bias: traits => (0.4 + traits.curious * 1.4) * (1.3 - traits.timid * 0.9),
        fit: context => {
            if (context.documentHidden) return 0.05;
            return context.recentPageChange ? 1.5 : 1;
        },
        requires: 'none',
    },
    {
        id: 'observe',
        activity: 'idle',
        minDurationMs: 14_000,
        cooldownMs: 10_000,
        need: 'curiosity',
        base: 0.72,
        // 胆小的宠物更倾向于先观察而不是走过去
        bias: traits => (0.4 + traits.curious * 0.9) * (0.5 + traits.timid * 1.3),
        fit: context => (context.userActive ? 1.1 : 0.8),
        requires: 'none',
    },
    {
        // idle 是「没有目标」的兜底，不是一个和别人抢的竞争者——
        // 所以它的基础分刻意压得比任何真实目标都低，且不参与滞回（见
        // shouldSwitch）。改造前 base 0.2 加上 0.15 滞回，等于要求宠物
        // 「相当想做某事」才肯动，实测结果是它 75% 的时间在发呆。
        id: 'idle',
        activity: 'idle',
        minDurationMs: 4_000,
        cooldownMs: 0,
        need: null,
        base: 0.12,
        bias: () => 1,
        fit: () => 1,
        requires: 'none',
    },
];

/**
 * 冷却系数。刚做完的目标短时间内评分被压低，但不会归零——
 * 需求足够紧迫时仍能突破冷却。
 */
function cooldownFactor(definition: GoalDefinition, context: GoalContext): number {
    if (definition.cooldownMs <= 0) return 1;
    const lastRun = context.lastRunAt[definition.id];
    if (!lastRun) return 1;
    const elapsed = context.now - lastRun;
    if (elapsed >= definition.cooldownMs) return 1;
    return 0.15 + 0.85 * (elapsed / definition.cooldownMs);
}

/** 安静模式压低所有主动性目标；关闭时只保留 idle 和 sleep。 */
function initiativeFactor(definition: GoalDefinition, context: GoalContext): number {
    if (definition.id === 'idle' || definition.id === 'sleep' || definition.id === 'rest') {
        return 1;
    }
    if (context.initiative === 'off') return 0;
    if (context.initiative === 'quiet') return 0.4;
    return 1;
}

/**
 * 对全部候选目标打分并降序排列。
 *
 * score = needUrgency × personalityBias × contextFit
 *       × relationshipFactor × cooldownFactor × smallRandomness
 */
export function evaluateGoals(
    needs: PetNeeds,
    traits: PetTraits,
    relationship: PetRelationship,
    context: GoalContext,
): ScoredGoal[] {
    const need = urgency(needs);
    return DEFINITIONS
        .map(definition => {
            const needUrgency = definition.need === null
                ? definition.base
                : definition.base * need[definition.need];
            const score = needUrgency
                * definition.bias(traits)
                * definition.fit(context)
                * relationshipFactor(relationship, definition.requires)
                * cooldownFactor(definition, context)
                * initiativeFactor(definition, context)
                * (0.9 + Math.random() * 0.2);
            const { id, activity, reaction, minDurationMs, cooldownMs } = definition;
            return { id, activity, reaction, minDurationMs, cooldownMs, score };
        })
        .sort((left, right) => right.score - left.score);
}

/**
 * 该不该从当前目标切到候选目标。
 *
 * 滞回**只用于目标之间**，不用于「从发呆变成做点什么」。idle 是没有目标的
 * 状态，离开它应该是免费的；要求候选目标额外赢过 idle 0.15 分，等于要求宠物
 * 「相当想做某事」才肯动——实测那样它 75% 的时间在发呆，而且性格差异被压平了
 *（所有目标的分数都在门槛以下，谁也过不去，排序就无关紧要了）。
 */
export function shouldSwitch(
    candidate: ScoredGoal,
    currentGoal: PetGoalId,
    currentScore: number,
): boolean {
    if (candidate.id === currentGoal) return false;
    const margin = currentGoal === 'idle' ? 0 : GOAL_SWITCH_MARGIN;
    return candidate.score >= currentScore + margin;
}

/**
 * 目标 → 身体活动。
 *
 * 供 Agent 提案这条路径用：Cognition Agent 给的是一个目标名，
 * 仲裁器要的是一个活动。不认识的目标回落到 idle——模型编出来的名字
 * 已经在服务端挡过一道，这里是第二道。
 */
export function activityForGoal(goal: string): PetPersistentActivity {
    return DEFINITIONS.find(definition => definition.id === goal)?.activity ?? 'idle';
}

/** 判断某个目标当前是否已达到「需求」优先级。 */
export function isUrgent(goal: PetGoalId, needs: PetNeeds): boolean {
    const definition = DEFINITIONS.find(candidate => candidate.id === goal);
    if (!definition?.need) return false;
    return urgency(needs)[definition.need] >= NEED_PRIORITY_THRESHOLD;
}
