'use client';

import { apiUrl } from './client';

const eventBaseUrl = (process.env.NEXT_PUBLIC_EVENT_BASE_URL ?? '').replace(/\/+$/, '');

function serverEventsUrl(): string {
    return eventBaseUrl
        ? `${eventBaseUrl}/api/v1/events`
        : apiUrl('/events');
}

export interface ResourceChangedEvent {
    type: 'resource.changed';
    resource: string;
    action: 'created' | 'updated' | 'deleted' | string;
    id: string;
    version?: string | number;
}

export interface PetActionEvent {
    type: 'pet.action';
    action: string;
    animation?: string;
    assetId?: string | null;
    message?: string;
    duration?: number;
    payload?: Record<string, unknown>;
}

/**
 * 任务语义状态（架构文档 §6.2）。
 *
 * 与 `tool.*` 的关系：`tool.*` 是执行层审计，`agent.task.*` 是语义层。
 * 宠物只消费语义层——它不需要知道调的是哪个工具，只需要知道现在在做哪一类事。
 *
 * `confirmation_required` 目前**没有生产者**：后端还没有确认闸门，写操作直接执行。
 * 这里先把契约定下来，前端也已能处理，闸门本身随 P4 §7.4 的工具白名单一起落地。
 */
export type AgentTaskStatus =
    | 'created'
    | 'planning'
    | 'confirmation_required'
    | 'running'
    | 'progress'
    | 'waiting'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export interface AgentTaskEvent {
    type: `agent.task.${AgentTaskStatus}`;
    taskId: string;
    /** site.memo / site.reminder / … 见架构文档 §6.1 */
    capability: string;
    /** 由工具名与资源类型拼出，**不含 payload** */
    safeSummary: string;
    riskLevel: 'none' | 'low' | 'high';
    /** 任务内的步骤序号，任务级事件没有 */
    sequence?: number;
}

/**
 * 对方发来私信。**刻意不带正文**——SSE 是广播给所有连接的，正文只该由
 * 收件人自己去拉（见 api.py 的 send_direct_message）。
 */
export interface ChatMessageEvent {
    type: 'chat.message';
    messageId: string;
    senderId: string;
    recipientId: string;
    hasAttachments: boolean;
}

/**
 * 注意 `AgentTaskEvent` 不在这个联合里：任务事件走的是 `/chat/stream`
 * 那条 SSE（任务的生命周期就在那一轮对话里），不经过全站 outbox 通道。
 * 等 AgentTask 能脱离对话独立存在时，再并入这里。
 */
export type ServerEvent = ResourceChangedEvent | PetActionEvent | ChatMessageEvent;
export type ServerEventType = ServerEvent['type'];
type EventListener<T extends ServerEvent = ServerEvent> = (event: T) => void;

interface SharedEventState {
    listeners: Map<ServerEventType, Set<EventListener>>;
    eventSource: EventSource | null;
    closeTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
    interface Window {
        __kittyServerEvents?: SharedEventState;
    }
}

function sharedState(): SharedEventState {
    if (!window.__kittyServerEvents) {
        window.__kittyServerEvents = {
            listeners: new Map(),
            eventSource: null,
            closeTimer: null,
        };
    }
    return window.__kittyServerEvents;
}

function parseEvent<T extends ServerEvent>(type: ServerEventType, message: MessageEvent<string>): T | null {
    try {
        const data = JSON.parse(message.data) as Record<string, unknown>;
        return { ...data, type } as T;
    } catch (error) {
        console.warn(`忽略无法解析的 SSE 事件：${type}`, error);
        return null;
    }
}

function dispatch(type: ServerEventType, message: MessageEvent<string>) {
    const event = parseEvent(type, message);
    if (!event) return;
    sharedState().listeners.get(type)?.forEach(listener => listener(event));
}

function ensureConnected() {
    if (typeof window === 'undefined') return;
    const state = sharedState();
    if (state.eventSource || state.listeners.size === 0) return;

    state.eventSource = new EventSource(serverEventsUrl(), { withCredentials: true });
    state.eventSource.addEventListener('resource.changed', message =>
        dispatch('resource.changed', message as MessageEvent<string>));
    state.eventSource.addEventListener('pet.action', message =>
        dispatch('pet.action', message as MessageEvent<string>));
    state.eventSource.addEventListener('chat.message', message =>
        dispatch('chat.message', message as MessageEvent<string>));
    state.eventSource.addEventListener('message', message => {
        try {
            const event = JSON.parse((message as MessageEvent<string>).data) as ServerEvent;
            if (
                event?.type === 'resource.changed'
                || event?.type === 'pet.action'
                || event?.type === 'chat.message'
            ) {
                state.listeners.get(event.type)?.forEach(listener => listener(event));
            }
        } catch {
            // 心跳或无类型消息不需要交给业务订阅者。
        }
    });
}

function scheduleCloseIfIdle() {
    const state = sharedState();
    if ([...state.listeners.values()].some(group => group.size > 0)) return;
    state.closeTimer = setTimeout(() => {
        state.eventSource?.close();
        state.eventSource = null;
        state.listeners.clear();
        state.closeTimer = null;
    }, 1_000);
}

export function subscribeServerEvent<T extends ServerEvent>(
    type: T['type'],
    listener: EventListener<T>,
): () => void {
    const state = sharedState();
    if (state.closeTimer) {
        clearTimeout(state.closeTimer);
        state.closeTimer = null;
    }

    const group = state.listeners.get(type) ?? new Set<EventListener>();
    group.add(listener as EventListener);
    state.listeners.set(type, group);
    ensureConnected();

    return () => {
        group.delete(listener as EventListener);
        if (group.size === 0) state.listeners.delete(type);
        scheduleCloseIfIdle();
    };
}
