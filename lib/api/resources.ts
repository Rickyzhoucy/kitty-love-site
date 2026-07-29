/** Python 领域服务的资源契约。 */
import { api } from './client';

export interface EventTimer {
    id: string;
    title: string;
    date: string;
    type: 'countdown' | 'countup' | string;
    description?: string | null;
    createdAt: string;
}

export interface Reminder {
    id: string;
    content: string;
    dueDate: string;
    completed: boolean;
    createdAt: string;
}

export interface Memo {
    id: string;
    category: string;
    text: string;
    completed: boolean;
    createdAt: string;
}

export interface Message {
    id: string;
    nickname: string;
    content: string;
    createdAt: string;
}

export interface Milestone {
    id: string;
    date: string;
    title: string;
    description: string;
    createdAt: string;
}

export interface Photo {
    id: string;
    attachmentId: string;
    url: string;
    caption: string;
    date?: string | null;
    createdAt: string;
}

export type SiteConfig = Record<string, string>;

export interface SiteConfigHistory {
    id: string;
    key: string;
    value: string;
    createdAt: string;
}

export const timersApi = {
    list: () => api.get<EventTimer[]>('/timers'),
    create: (data: { title: string; date: string; type: string; description?: string }) =>
        api.post<EventTimer>('/timers', data),
    update: (id: string, data: Partial<Pick<EventTimer, 'title' | 'date' | 'type' | 'description'>>) =>
        api.patch<EventTimer>(`/timers/${encodeURIComponent(id)}`, data),
    remove: (id: string) => api.delete<void>(`/timers/${encodeURIComponent(id)}`),
};

export const remindersApi = {
    list: () => api.get<Reminder[]>('/reminders'),
    create: (data: { content: string; dueDate: string }) => api.post<Reminder>('/reminders', data),
    update: (id: string, completed: boolean) =>
        api.patch<Reminder>(`/reminders/${encodeURIComponent(id)}`, { completed }),
    remove: (id: string) => api.delete<void>(`/reminders/${encodeURIComponent(id)}`),
};

export const memosApi = {
    list: () => api.get<Memo[]>('/memos'),
    create: (data: { category: string; text: string }) => api.post<Memo>('/memos', data),
    update: (id: string, completed: boolean) =>
        api.patch<Memo>(`/memos/${encodeURIComponent(id)}`, { completed }),
    remove: (id: string) => api.delete<void>(`/memos/${encodeURIComponent(id)}`),
};

export const messagesApi = {
    list: () => api.get<Message[]>('/messages'),
    create: (data: { nickname: string; content: string }) => api.post<Message>('/messages', data),
    remove: (id: string) => api.delete<void>(`/messages/${encodeURIComponent(id)}`),
};

export const milestonesApi = {
    list: () => api.get<Milestone[]>('/milestones'),
    create: (data: { date: string; title: string; description: string }) =>
        api.post<Milestone>('/milestones', data),
    remove: (id: string) => api.delete<void>(`/milestones/${encodeURIComponent(id)}`),
};

export const photosApi = {
    list: () => api.get<Photo[]>('/photos'),
    create: (data: { attachmentId: string; caption: string; date?: string }) => api.post<Photo>('/photos', data),
    remove: (id: string) => api.delete<void>(`/photos/${encodeURIComponent(id)}`),
};

export const configApi = {
    get: () => api.get<SiteConfig>('/config'),
    update: (values: SiteConfig) => api.put<SiteConfig>('/config', values),
    reset: (keys: string[]) => api.post<void>('/config/reset', keys),
    history: () => api.get<SiteConfigHistory[]>('/config/history'),
    rollback: (id: string) =>
        api.post<SiteConfig>(`/config/history/${encodeURIComponent(id)}/rollback`),
};
