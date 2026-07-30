'use client';

import { api } from './client';

export interface Conversation {
    id: string;
    createdAt: string;
    updatedAt: string;
    userId: string;
    companionId: string;
    title: string | null;
    /** 首条用户发言的截断预览。没有它列表就只是一串日期。 */
    preview: string | null;
    messageCount: number;
}

export interface ChatMessage {
    id: string;
    createdAt: string;
    conversationId: string;
    role: 'user' | 'assistant' | string;
    content: string;
    metadata?: Record<string, unknown> | null;
}

export function listConversations(): Promise<Conversation[]> {
    return api.get<Conversation[]>('/conversations');
}

export function listMessages(conversationId: string): Promise<ChatMessage[]> {
    return api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`);
}

export function createConversation(title?: string): Promise<Conversation> {
    return api.post<Conversation>('/conversations', { title: title ?? null });
}
