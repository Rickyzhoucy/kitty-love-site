'use client';

import { api } from './client';

/**
 * 认知请求（架构文档 §5）。
 *
 * 这是客户端唯一能触发模型的入口。`trigger` 会在服务端对照
 * `FORBIDDEN_TRIGGERS` 检查——鼠标移动、目光跟随、走路眨眼这些一律挡下。
 * 把闸门放在服务端而不是客户端，是因为客户端的判断可以被绕过，
 * 而预算是真金白银。
 */
export type CognitionRequestType =
    | 'user_message'
    | 'ambiguous_intent'
    | 'important_event'
    | 'proactive_thought'
    | 'relationship_reflection'
    | 'task_planning';

export interface CognitionRequestBody {
    type: CognitionRequestType;
    trigger?: string;
    needs: Record<string, number>;
    mood: Record<string, unknown>;
    relationship: Record<string, unknown>;
    page: string;
    localTime: string;
    recentInteractions: string[];
    activeTask?: string | null;
    initiative: 'normal' | 'quiet' | 'off';
}

export interface CognitionProposal {
    goal: string;
    emotion: string;
    reason: string;
    utterance: string | null;
    capabilityRequest: string | null;
    memoryProposal: string | null;
    expiresIn: number;
}

/**
 * 请求一次认知。返回 null 表示**没有想法**——被预算挡下、防抖掉、
 * 模型超时或输出没过校验都归到这里。调用方一律当作「这一刻宠物没话说」，
 * 不要重试。
 */
export async function requestCognition(
    body: CognitionRequestBody,
): Promise<CognitionProposal | null> {
    try {
        const proposal = await api.post<CognitionProposal | null>(
            '/pet/cognition',
            body,
        );
        return proposal ?? null;
    } catch {
        return null;
    }
}

/** 上报一条值得记住的事件，供 Reflection Agent 后台消费。 */
export async function recordPetEvent(
    type: string,
    payload: Record<string, unknown> = {},
    importance = 50,
): Promise<void> {
    try {
        await api.post('/pet/events', { type, payload, importance });
    } catch {
        // 记不上就算了，宠物的当下行为不依赖它。
    }
}
