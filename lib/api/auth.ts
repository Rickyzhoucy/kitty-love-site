import { api } from './client';
import {
    clearDesktopToken,
    isTauriDesktop,
    saveDesktopToken,
} from '@/lib/desktop';

export interface SessionUser {
    id: string;
    username: string;
    displayName: string;
}

export interface LoginResult {
    user: SessionUser;
    token: string | null;
    expiresAt: string;
}

export const authApi = {
    login: async (username: string, password: string) => {
        const desktop = isTauriDesktop();
        const result = await api.post<LoginResult>('/auth/login', {
            username,
            password,
            client: desktop ? 'desktop' : 'browser',
            deviceName: typeof navigator === 'undefined' ? 'Web' : navigator.userAgent.slice(0, 120),
        });
        if (desktop && result.token) await saveDesktopToken(result.token);
        return result;
    },
    me: () => api.get<SessionUser>('/auth/me'),
    logout: async () => {
        try {
            await api.post<void>('/auth/logout');
        } finally {
            await clearDesktopToken();
        }
    },
};
