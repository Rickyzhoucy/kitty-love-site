/** Python 领域服务的资源契约。 */
import { api } from './client';

/** 纪念日 / 倒数。没有 recurrence 的话，加了提醒也只灵一次。 */
export type Recurrence = 'none' | 'yearly' | 'monthly';

export interface EventTimer {
    id: string;
    title: string;
    date: string;
    type: 'countdown' | 'countup' | string;
    description?: string | null;
    recurrence: Recurrence;
    /** 提前几天提醒，例如 [7, 1, 0]。空数组表示不提醒。 */
    remindDaysBefore: number[];
    createdAt: string;
}

/** 要做的事。`dueAt` 为空就是没期限的那种，只在计划页出现，不上首页。 */
export interface Plan {
    id: string;
    title: string;
    note: string | null;
    dueAt: string | null;
    /** 用时间而不是布尔——心愿页要显示「什么时候做到的」，Plan 保持同一形状 */
    completedAt: string | null;
    createdAt: string;
    createdBy: string | null;
}

export type WishCategory = 'to-eat' | 'to-go' | 'to-buy';

/** 想一起做的事。没有期限，重点在「谁提的」和「什么时候做到的」。 */
export interface Wish {
    id: string;
    title: string;
    note: string | null;
    category: WishCategory;
    completedAt: string | null;
    completionPhotoId: string | null;
    createdAt: string;
    createdBy: string | null;
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
    /** GCJ-02 纬度。与 lng 同时为 null 表示这件事没有地点。 */
    lat: number | null;
    /** GCJ-02 经度 */
    lng: number | null;
    photoIds: string[];
}

/** 有地点的故事条目。地图视图只画这些。 */
export type PlacedMilestone = Milestone & { lat: number; lng: number };

export function hasPlace(milestone: Milestone): milestone is PlacedMilestone {
    return milestone.lat !== null && milestone.lng !== null;
}

export interface Photo {
    id: string;
    attachmentId: string;
    url: string;
    thumbnailUrl?: string | null;
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
    create: (data: {
        title: string;
        date: string;
        type: string;
        description?: string;
        recurrence?: Recurrence;
        remindDaysBefore?: number[];
    }) => api.post<EventTimer>('/timers', data),
    update: (
        id: string,
        data: Partial<Pick<EventTimer,
            'title' | 'date' | 'type' | 'description' | 'recurrence' | 'remindDaysBefore'>>,
    ) =>
        api.patch<EventTimer>(`/timers/${encodeURIComponent(id)}`, data),
    remove: (id: string) => api.delete<void>(`/timers/${encodeURIComponent(id)}`),
};

export const plansApi = {
    list: () => api.get<Plan[]>('/plans'),
    create: (data: { title: string; dueAt?: string | null; note?: string | null }) =>
        api.post<Plan>('/plans', data),
    update: (id: string, data: Partial<Pick<Plan, 'title' | 'note' | 'dueAt' | 'completedAt'>>) =>
        api.patch<Plan>(`/plans/${encodeURIComponent(id)}`, data),
    remove: (id: string) => api.delete<void>(`/plans/${encodeURIComponent(id)}`),
};

export const wishesApi = {
    list: () => api.get<Wish[]>('/wishes'),
    create: (data: { title: string; category: WishCategory; note?: string | null }) =>
        api.post<Wish>('/wishes', data),
    update: (
        id: string,
        data: Partial<Pick<Wish, 'title' | 'note' | 'category' | 'completedAt' | 'completionPhotoId'>>,
    ) => api.patch<Wish>(`/wishes/${encodeURIComponent(id)}`, data),
    remove: (id: string) => api.delete<void>(`/wishes/${encodeURIComponent(id)}`),
};

export const messagesApi = {
    list: () => api.get<Message[]>('/messages'),
    create: (data: { nickname: string; content: string }) => api.post<Message>('/messages', data),
    remove: (id: string) => api.delete<void>(`/messages/${encodeURIComponent(id)}`),
};

export interface MilestoneInput {
    date: string;
    title: string;
    description: string;
    lat?: number | null;
    lng?: number | null;
    photoIds?: string[];
}

export const milestonesApi = {
    list: () => api.get<Milestone[]>('/milestones'),
    create: (data: MilestoneInput) => api.post<Milestone>('/milestones', data),
    update: (id: string, data: Partial<MilestoneInput>) =>
        api.patch<Milestone>(`/milestones/${encodeURIComponent(id)}`, data),
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
