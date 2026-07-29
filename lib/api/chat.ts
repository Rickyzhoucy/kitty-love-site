'use client';

import { ApiError, apiUrl } from './client';
import type { PetActionEvent } from './events';
import { desktopAuthorizationHeaders } from '@/lib/desktop';

export interface TextDeltaEvent {
    type: 'text.delta';
    delta: string;
}

export interface ToolEvent {
    type: 'tool.started' | 'tool.completed';
    name: string;
    input?: unknown;
    output?: unknown;
}

export interface MessageCompletedEvent {
    type: 'message.completed';
    conversationId: string;
    messageId: string;
}

export type ChatStreamEvent = TextDeltaEvent | ToolEvent | PetActionEvent | MessageCompletedEvent;

function parseBlock(block: string): ChatStreamEvent | null {
    let eventType = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!eventType || dataLines.length === 0) return null;

    try {
        const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        return { ...data, type: eventType } as ChatStreamEvent;
    } catch {
        throw new ApiError(502, `聊天服务返回了无效的 ${eventType} 事件`);
    }
}

export async function streamChat(
    input: { conversationId: string | null; message: string; attachmentIds?: string[] },
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
): Promise<void> {
    let response: Response;
    try {
        response = await fetch(apiUrl('/chat/stream'), {
            method: 'POST',
            headers: {
                Accept: 'text/event-stream',
                'Content-Type': 'application/json',
                ...await desktopAuthorizationHeaders(),
            },
            body: JSON.stringify(input),
            credentials: 'include',
            signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, '无法连接伴侣服务', error);
    }

    if (response.status === 401 && !window.location.pathname.startsWith('/verify')) {
        window.location.assign(`/verify?redirect=${encodeURIComponent(window.location.pathname)}`);
    }
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new ApiError(response.status, payload?.detail || `聊天请求失败（${response.status}）`, payload);
    }
    if (!response.body) throw new ApiError(502, '聊天服务没有返回事件流');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
            const block = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            if (block && !block.startsWith(':')) {
                const event = parseBlock(block);
                if (event) onEvent(event);
            }
            boundary = buffer.indexOf('\n\n');
        }

        if (done) break;
    }

    const remainder = buffer.trim();
    if (remainder && !remainder.startsWith(':')) {
        const event = parseBlock(remainder);
        if (event) onEvent(event);
    }
}
