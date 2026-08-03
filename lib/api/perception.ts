import { api } from './client';

export type PerceptionSurface = 'web' | 'tauri_main' | 'tauri_pet';

export interface PerceptionEntity {
    id?: string;
    type: string;
    label: string;
    status?: string;
}

export interface PagePerceptionContext {
    pageTitle?: string;
    section?: string;
    focusedEntity?: PerceptionEntity;
    selectedEntity?: PerceptionEntity;
    visibleEntities?: PerceptionEntity[];
    activeTask?: string;
    filters?: Record<string, string | number | boolean>;
    counts?: Record<string, string | number | boolean>;
    interactionMode?: string;
}

export interface PerceptionSession {
    id: string;
    route: string;
    pageKind: string;
    pageContext: PagePerceptionContext;
    activeConversationId: string | null;
    foreground: boolean;
    revision: number;
    expiresAt: string;
}

export function writePerceptionSession(payload: {
    deviceSessionId: string;
    surface: PerceptionSurface;
    route: string;
    pageKind: string;
    pageContext: PagePerceptionContext;
    activeConversationId: string | null;
    foreground: boolean;
    revision: number;
}): Promise<PerceptionSession> {
    return api.put<PerceptionSession>('/perception/session', payload);
}

export function readCurrentPerceptionSession(): Promise<PerceptionSession | null> {
    return api.get<PerceptionSession | null>('/perception/session/current');
}

export function emitPerceptionEvent(payload: {
    type: string;
    subjectType?: string;
    subjectId?: string;
    data?: Record<string, unknown>;
    retention?: 'ephemeral' | 'working' | 'episodic' | 'audit';
    sensitivity?: 'normal' | 'sensitive' | 'restricted';
    dedupeKey: string;
}): Promise<unknown> {
    return api.post('/perception/events', {
        source: 'kitty-love.web',
        retention: 'working',
        sensitivity: 'normal',
        ...payload,
    });
}

export function setPagePerception(context: PagePerceptionContext): void {
    window.dispatchEvent(new CustomEvent('kitty:perception-context', { detail: context }));
}
