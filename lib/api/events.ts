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

export type ServerEvent = ResourceChangedEvent | PetActionEvent;
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
    state.eventSource.addEventListener('message', message => {
        try {
            const event = JSON.parse((message as MessageEvent<string>).data) as ServerEvent;
            if (event?.type === 'resource.changed' || event?.type === 'pet.action') {
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
