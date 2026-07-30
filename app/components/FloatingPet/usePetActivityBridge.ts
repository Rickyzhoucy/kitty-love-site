'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
    subscribeServerEvent,
    type AgentTaskEvent,
    type AgentTaskStatus,
    type PetActionEvent,
    type ResourceChangedEvent,
} from '@/lib/api/events';
import {
    toPetReaction,
    type PetPersistentActivity,
    type PetReaction,
} from './petBodyProtocol';

interface UsePetActivityBridgeOptions {
    disabled?: boolean;
    setActivity: (activity: PetPersistentActivity) => void;
    suggestTask: (activity: PetPersistentActivity | null) => void;
    react: (reaction: PetReaction) => void;
    showSpeech: (text: string, duration?: number) => void;
    refetchPet: () => Promise<void>;
}

const PERSISTENT_ACTIONS = new Set<PetPersistentActivity>([
    'idle',
    'walking',
    'sleeping',
    'held',
    'thinking',
    'working',
    'waiting',
    'asking',
]);

/**
 * 任务状态 → 身体活动（架构文档 §6.3）。
 *
 * null 表示任务离开了「有事在做」的状态，交还身体控制权。这张表只产生**建议**，
 * 最终由仲裁器按优先级带决定——用户正在拖动宠物时，任务反馈让位。
 */
const TASK_ACTIVITY: Record<AgentTaskStatus, PetPersistentActivity | null> = {
    // created 就接管身体，避免与前端发消息时的乐观 thinking 之间出现一帧空档。
    created: 'thinking',
    planning: 'thinking',
    confirmation_required: 'asking',
    running: 'working',
    // 工具刚返回、模型还没开始决定下一步的空档。归到 thinking 而不是留在
    // working，否则一串工具调用之间会看不出「做完一件事」的节奏。
    progress: 'thinking',
    waiting: 'waiting',
    succeeded: null,
    failed: null,
    cancelled: null,
};

/**
 * 终态的一次性反应。
 *
 * cancelled 是用户自己叫停的，不该有情绪表达。succeeded 还要额外看步骤数：
 * 只回了一句话就庆祝，跟改造前「删掉一条备忘录也放烟花」是同一类错误。
 */
const TASK_REACTION: Partial<Record<AgentTaskStatus, PetReaction>> = {
    succeeded: 'celebrate',
    failed: 'confused',
};

export function usePetActivityBridge({
    disabled = false,
    setActivity,
    suggestTask,
    react,
    showSpeech,
    refetchPet,
}: UsePetActivityBridgeOptions) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearActivityTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const playPetAction = useCallback((event: Pick<
        PetActionEvent,
        'action' | 'animation' | 'message' | 'duration'
    >) => {
        if (event.message) showSpeech(event.message, event.duration ?? 3_000);
        const action = event.animation ?? event.action;
        const reaction = toPetReaction(action);
        if (reaction) {
            react(reaction);
            return;
        }
        if (!PERSISTENT_ACTIONS.has(action as PetPersistentActivity)) return;
        clearActivityTimer();
        setActivity(action as PetPersistentActivity);
        if (action !== 'idle') {
            timerRef.current = setTimeout(
                () => setActivity('idle'),
                event.duration ?? 1_800,
            );
        }
    }, [clearActivityTimer, react, setActivity, showSpeech]);

    /**
     * 消费一条语义任务事件。
     *
     * 这里刻意不看 `tool.*`——那是执行层审计，工具名对宠物没有意义。宠物只关心
     * 「在规划 / 在做 / 在等 / 成了 / 砸了」，正是 agent.task.* 提供的粒度。
     */
    const applyTaskEvent = useCallback((event: AgentTaskEvent) => {
        const status = event.type.slice('agent.task.'.length) as AgentTaskStatus;
        const activity = TASK_ACTIVITY[status];
        suggestTask(activity);

        const reaction = TASK_REACTION[status];
        const didSomething = (event.sequence ?? 0) > 0;
        if (reaction && (status !== 'succeeded' || didSomething)) react(reaction);

        // safeSummary 由后端按工具名和资源类型拼出，不含 payload，可以直接显示。
        if (status === 'running' || status === 'waiting') {
            showSpeech(`${event.safeSummary}…`, 0);
        } else if (status === 'confirmation_required') {
            showSpeech(`要我${event.safeSummary}吗？`, 0);
        }
    }, [react, showSpeech, suggestTask]);

    useEffect(() => {
        if (disabled) return;
        const unsubscribePet = subscribeServerEvent<PetActionEvent>('pet.action', event => {
            playPetAction(event);
            void refetchPet();
        });
        const unsubscribeResource = subscribeServerEvent<ResourceChangedEvent>(
            'resource.changed',
            () => {
                // 资源变更只是数据落地的回执，语义已经由 agent.task.* 表达过了。
                // 这里只刷新宠物数据，不再重复播一次动画。
                void refetchPet();
            },
        );
        return () => {
            unsubscribePet();
            unsubscribeResource();
            clearActivityTimer();
        };
    }, [clearActivityTimer, disabled, playPetAction, refetchPet]);

    return {
        playPetAction,
        applyTaskEvent,
        /** 用户刚发出消息、后端还没回第一个事件时的乐观状态 */
        beginThinking: () => suggestTask('thinking'),
        /** 请求失败在本地终结，后端不会再补一条 agent.task.failed */
        fail: () => {
            suggestTask(null);
            react('fail');
        },
        endTask: () => suggestTask(null),
    };
}
