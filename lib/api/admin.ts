/**
 * 后台接口客户端。
 *
 * 与主站接口共用底层的 `api`（同一套错误处理、同一个 `credentials: 'include'`），
 * 但**走的是另一套会话**：浏览器发的是 `kitty_admin` Cookie，服务端用
 * `AdminSession` 校验。主站的 `kitty_session` 在这些接口上一文不值。
 */

import { api } from './client';

export interface AdminMe {
    id: string;
    username: string;
    status: string;
}

export type SettingKind =
    | 'str' | 'text' | 'int' | 'float' | 'bool' | 'time' | 'choice' | 'secret';

export interface SettingDescriptor {
    key: string;
    group: string;
    groupLabel: string;
    label: string;
    kind: SettingKind;
    help: string;
    minimum: number | null;
    maximum: number | null;
    choices: string[];
    restartRequired: boolean;
    /** 是否被后台改过。false 表示当前值跟着 `.env` 走。 */
    overridden: boolean;
    /** 密钥类型这里是遮罩（`sk-ab••••3456`），不是明文。 */
    value: string | number | boolean;
}

export interface ConfigPayload {
    groups: Record<string, string>;
    settings: SettingDescriptor[];
}

export interface MemoryRow {
    id: string;
    scope: string;
    kind: string;
    content: string;
    importance: number;
    created_at: string;
    occurred_at: string | null;
}

export interface SkillRow {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    activeVersionId: string | null;
    versionCount: number;
    createdAt: string;
}

export interface ToolRunRow {
    id: string;
    tool: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    arguments: Record<string, unknown>;
    resultSize: number;
}

export interface AccountRow {
    id: string;
    username: string;
    displayName: string;
    enabled: boolean;
    activeSessions: number;
    createdAt: string;
}

export interface PersonaRow {
    id: string;
    companionId: string;
    companionName: string;
    name: string;
    prompt: string;
    version: number;
}

export interface DashboardPayload {
    counts: Record<string, number>;
    failedToolRuns: number;
    configOverrides: number;
    pet: { dailyCallBudget: number; dailyProactiveBudget: number; quiet: string };
    chatModel: string;
    embeddingModel: string;
}

const base = '/admin';

export const adminApi = {
    login: (username: string, password: string) =>
        api.post<AdminMe>(`${base}/auth/login`, { username, password }),
    logout: () => api.post<void>(`${base}/auth/logout`),
    me: () => api.get<AdminMe>(`${base}/auth/me`),
    changePassword: (currentPassword: string, newPassword: string) =>
        api.post<void>(`${base}/auth/password`, {
            current_password: currentPassword,
            new_password: newPassword,
        }),

    dashboard: () => api.get<DashboardPayload>(`${base}/dashboard`),

    config: () => api.get<ConfigPayload>(`${base}/config`),
    saveConfig: (values: Record<string, string>) =>
        api.patch<{ changed: string[]; settings: SettingDescriptor[] }>(
            `${base}/config`, { values },
        ),
    resetConfig: (keys: string[]) =>
        api.post<{ reset: string[]; settings: SettingDescriptor[] }>(
            `${base}/config/reset`, { keys },
        ),

    memories: (params: Record<string, string | number> = {}) => {
        const query = new URLSearchParams(
            Object.entries(params)
                .filter(([, value]) => value !== '' && value !== 0)
                .map(([key, value]) => [key, String(value)]),
        ).toString();
        return api.get<MemoryRow[]>(`${base}/memories${query ? `?${query}` : ''}`);
    },
    memoryFacets: () => api.get<{
        kinds: { value: string; count: number }[];
        scopes: { value: string; count: number }[];
        total: number;
    }>(`${base}/memories/facets`),
    updateMemory: (id: string, patch: { content?: string; importance?: number }) =>
        api.patch<MemoryRow>(`${base}/memories/${id}`, patch),
    deleteMemory: (id: string) => api.delete<void>(`${base}/memories/${id}`),

    skills: () => api.get<SkillRow[]>(`${base}/skills`),
    toggleSkill: (id: string, enabled: boolean) =>
        api.patch<{ id: string; enabled: boolean }>(`${base}/skills/${id}`, { enabled }),
    skillVersions: (id: string) =>
        api.get<{ id: string; revision: string; sha256: string; createdAt: string }[]>(
            `${base}/skills/${id}/versions`,
        ),

    toolRuns: (params: Record<string, string> = {}) => {
        const query = new URLSearchParams(
            Object.entries(params).filter(([, v]) => v),
        ).toString();
        return api.get<{
            runs: ToolRunRow[];
            summary: { tool: string; status: string; count: number }[];
        }>(`${base}/tool-runs${query ? `?${query}` : ''}`);
    },

    personas: () => api.get<PersonaRow[]>(`${base}/personas`),
    updatePersona: (id: string, prompt: string) =>
        api.patch<{ id: string; version: number }>(`${base}/personas/${id}`, { prompt }),

    accounts: () => api.get<{ maxUsers: number; accounts: AccountRow[] }>(`${base}/accounts`),
    createAccount: (username: string, displayName: string, password: string) =>
        api.post<{ id: string; username: string; displayName: string }>(`${base}/accounts`, {
            username, display_name: displayName, password,
        }),
    resetAccountPassword: (id: string, newPassword: string) =>
        api.post<void>(`${base}/accounts/${id}/password`, { new_password: newPassword }),
    toggleAccount: (id: string, enabled: boolean) =>
        api.patch<{ id: string; enabled: boolean }>(`${base}/accounts/${id}`, { enabled }),
    revokeSessions: (id: string) =>
        api.post<void>(`${base}/accounts/${id}/sessions/revoke`),

    /** 上传首页素材。走 FormData，所以不用 `api.post`（它会 JSON 序列化）。 */
    uploadHero: async (slot: 'video' | 'poster', file: File) => {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`/api/v1${base}/hero/${slot}`, {
            method: 'POST',
            body: form,
            credentials: 'include',
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            throw new Error(detail?.detail ?? `上传失败（${response.status}）`);
        }
        return response.json() as Promise<{ slot: string; objectKey: string; size: number }>;
    },
    resetHero: (slot: 'video' | 'poster') => api.delete<void>(`${base}/hero/${slot}`),
};
