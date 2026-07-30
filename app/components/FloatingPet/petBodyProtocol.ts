export type PetPersistentActivity =
    | 'idle'
    | 'walking'
    | 'sleeping'
    | 'held'
    | 'thinking'
    | 'working'
    /** 任务卡在外部返回上——有事在做，但不是自己在做 */
    | 'waiting'
    /** 任务需要用户确认，宠物在等一个回答 */
    | 'asking';

export type PetReaction =
    | 'celebrate'
    | 'land'
    | 'eat'
    | 'play'
    | 'tapHead'
    | 'tapBody'
    | 'success'
    | 'fail'
    /** 没看懂 / 任务失败但不是错误，与 fail 的急抖刻意区分 */
    | 'confused';

export type PetFacing = 'left' | 'right';
export type PetInitiative = 'normal' | 'quiet' | 'off';

/** 与架构文档 §7 PetPresentationState.emotion 对齐。由行为脑计算，身体只负责表现。 */
export type PetEmotion = 'happy' | 'normal' | 'curious' | 'sad' | 'focused';

export interface PetGaze {
    x: number;
    y: number;
}

export interface PetReactionEvent {
    name: PetReaction;
    nonce: number;
}

export interface PetBodyState {
    activity: PetPersistentActivity;
    facing: PetFacing;
    gaze: PetGaze;
    emotion: PetEmotion;
    reaction: PetReactionEvent | null;
}

export const IDLE_BODY_STATE: PetBodyState = {
    activity: 'idle',
    facing: 'left',
    gaze: { x: 0, y: 0 },
    emotion: 'normal',
    reaction: null,
};

const REACTION_ALIASES: Record<string, PetReaction> = {
    happy: 'celebrate',
    celebrate: 'celebrate',
    success: 'success',
    done: 'success',
    error: 'fail',
    failed: 'fail',
    fail: 'fail',
    eat: 'eat',
    play: 'play',
    land: 'land',
    tapHead: 'tapHead',
    tapBody: 'tapBody',
    confused: 'confused',
    puzzled: 'confused',
};

export function toPetReaction(action: string): PetReaction | null {
    return REACTION_ALIASES[action] ?? null;
}
