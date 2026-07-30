import type { PetPersistentActivity } from '../petBodyProtocol';

/**
 * 优先级带，对应架构文档 §7 的行为优先级链：
 *
 *   拖动 / 落下 / 身体安全
 *   > 用户直接身体互动
 *   > 任务确认
 *   > 任务状态反馈
 *   > 生理和关系需求
 *   > Agent 高层建议
 *   > 自主闲逛
 *   > 随机微动作
 *
 * Agent 的建议位于倒数第三级——行为脑保留最终否决权（§2 原则 4）。
 */
export const BAND = {
    SAFETY: 100,
    DIRECT: 90,
    TASK_CONFIRM: 80,
    TASK_FEEDBACK: 70,
    NEEDS: 60,
    AGENT: 50,
    IDLE: 40,
    MICRO: 30,
} as const;

export type ArbiterBand = typeof BAND[keyof typeof BAND];

export interface ActivityClaim {
    /** 同一 source 的新 claim 覆盖旧 claim */
    source: string;
    activity: PetPersistentActivity;
    band: ArbiterBand;
    /** 绝对时间戳；null 表示常驻直到被显式撤销 */
    expiresAt: number | null;
    /** 最早可被同带或更低带替换的时间，用于目标的 minDuration */
    holdUntil: number;
}

export type ClaimStore = ReadonlyArray<ActivityClaim>;

export const EMPTY_CLAIMS: ClaimStore = [];

export function claim(
    claims: ClaimStore,
    next: ActivityClaim,
): ClaimStore {
    return [...claims.filter(entry => entry.source !== next.source), next];
}

/** 没有该 source 时返回原数组——释放是高频调用（每个流式 token 一次）。 */
export function release(claims: ClaimStore, source: string): ClaimStore {
    const kept = claims.filter(entry => entry.source !== source);
    return kept.length === claims.length ? claims : kept;
}

/** 清掉过期项。返回原数组以便调用方跳过无谓的状态更新。 */
export function prune(claims: ClaimStore, now: number): ClaimStore {
    const kept = claims.filter(entry => entry.expiresAt === null || entry.expiresAt > now);
    return kept.length === claims.length ? claims : kept;
}

/**
 * 仲裁出当前应该表现的活动。
 *
 * 规则：取最高 band；同 band 内取最后加入的（后来者覆盖）。
 * 没有任何 claim 时回落到 idle——身体永远有一个确定状态。
 */
export function resolve(claims: ClaimStore, now: number): {
    activity: PetPersistentActivity;
    band: ArbiterBand;
    source: string;
} {
    const live = claims.filter(entry => entry.expiresAt === null || entry.expiresAt > now);
    if (live.length === 0) {
        return { activity: 'idle', band: BAND.IDLE, source: 'default' };
    }
    let winner = live[0];
    for (const entry of live) {
        if (entry.band >= winner.band) winner = entry;
    }
    return { activity: winner.activity, band: winner.band, source: winner.source };
}

/**
 * 自主目标能否被替换。
 *
 * minDuration 只约束同带或更低带的抢占；更高优先级（用户拖动、任务反馈）
 * 随时可以打断，否则摸头会被「宠物正在闲逛」挡住。
 */
export function canPreempt(
    claims: ClaimStore,
    source: string,
    band: ArbiterBand,
    now: number,
): boolean {
    const existing = claims.find(entry => entry.source === source);
    if (!existing) return true;
    if (band > existing.band) return true;
    return now >= existing.holdUntil;
}
