import { api } from './client';

export type MemoryVisibility = 'user_private' | 'couple_shared' | 'companion_relationship';
export type MemoryStatus = 'active' | 'pending_review' | 'retracted' | 'superseded' | 'contested';
export type MemoryType = 'fact' | 'preference' | 'commitment' | 'episode' | 'interaction_preference' | 'relationship';

export interface MemoryRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    visibility: MemoryVisibility;
    memoryType: MemoryType;
    content: string;
    importance: number;
    confidence: number;
    sensitivity: 'normal' | 'sensitive' | 'restricted';
    status: MemoryStatus;
    lastAccessedAt: string | null;
    accessCount: number;
    extractorVersion: string;
    createdByKind: 'user' | 'system';
}

export interface MemoryEvidence {
    id: string;
    sourceType: string;
    sourceId: string;
    actorUserId: string | null;
    excerpt: string | null;
    observedAt: string;
}

export interface MemoryPreference {
    paused: boolean;
    referenceEnabled: boolean;
    conversationEnabled: boolean;
    directMessageEnabled: boolean;
    moodEnabled: boolean;
    dailyQuestionEnabled: boolean;
    futureLetterEnabled: boolean;
    referenceAvailable: boolean;
    privateExtractionAvailable: boolean;
    sharedExtractionAvailable: boolean;
}

export interface MemoryMutation {
    memory: MemoryRecord;
    receipt: { id: string; status: 'committed'; safeSummary: string };
}

export function listMemories(filters: {
    visibility?: MemoryVisibility;
    status?: MemoryStatus;
    query?: string;
} = {}): Promise<MemoryRecord[]> {
    const params = new URLSearchParams();
    if (filters.visibility) params.set('visibility', filters.visibility);
    if (filters.status) params.set('status', filters.status);
    if (filters.query) params.set('q', filters.query);
    return api.get(`/memories?${params.toString()}`);
}

export function createMemory(payload: {
    visibility: MemoryVisibility;
    memoryType: MemoryType;
    content: string;
    importance?: number;
}): Promise<MemoryMutation> {
    return api.post('/memories/explicit', {
        ...payload,
        sourceType: 'explicit_user',
        subjectType: payload.visibility === 'couple_shared' ? 'couple' : 'user',
    });
}

export function correctMemory(id: string, content: string): Promise<MemoryMutation> {
    return api.post(`/memories/${id}/correct`, { content, reason: '在记忆设置中纠正' });
}

export function retractMemory(id: string): Promise<MemoryMutation> {
    return api.post(`/memories/${id}/retract`);
}

export function restoreMemory(id: string): Promise<MemoryMutation> {
    return api.post(`/memories/${id}/restore`);
}

export function approveMemory(id: string): Promise<MemoryMutation> {
    return api.post(`/memories/${id}/approve`);
}

export function memoryEvidence(id: string): Promise<MemoryEvidence[]> {
    return api.get(`/memories/${id}/evidence`);
}

export function excludeMemoryEvidence(
    memoryId: string,
    evidenceId: string,
): Promise<MemoryMutation> {
    return api.post(`/memories/${memoryId}/evidence/${evidenceId}/exclude`);
}

export function getMemoryPreferences(): Promise<MemoryPreference> {
    return api.get('/memory-preferences');
}

export function updateMemoryPreferences(
    changes: Partial<MemoryPreference>,
): Promise<MemoryPreference> {
    return api.patch('/memory-preferences', changes);
}
