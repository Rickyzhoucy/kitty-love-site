'use client';

import { api } from './client';

/**
 * 未来情书（计划文档 §2.6）。
 *
 * `body` 是 `string | null`：**没解锁的时候服务端根本不发正文**，不是发过来
 * 让前端藏。所以这里不需要（也不该有）任何「判断要不要显示」的逻辑——拿到
 * null 就是还没到时候。
 */

export interface FutureLetter {
    id: string;
    createdAt: string;
    authorId: string;
    unlockAt: string;
    openedAt: string | null;
    unlocked: boolean;
    /** 未解锁时为 null */
    body: string | null;
    /** 未解锁时为空数组 */
    attachmentIds: string[];
}

export function fetchLetters(): Promise<FutureLetter[]> {
    return api.get<FutureLetter[]>('/letters');
}

export function fetchLetter(id: string): Promise<FutureLetter> {
    return api.get<FutureLetter>(`/letters/${id}`);
}

export function writeLetter(
    body: string,
    unlockAt: string,
    attachmentIds: string[] = [],
): Promise<FutureLetter> {
    return api.post<FutureLetter>('/letters', { body, unlockAt, attachmentIds });
}
