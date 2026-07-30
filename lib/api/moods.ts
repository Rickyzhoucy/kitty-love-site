'use client';

import { api } from './client';

/**
 * 情绪打卡（计划文档 §2.4）。
 *
 * 一次返回两个人的曲线——画在一起才有意义。写入是 PUT 而不是 POST：一人一天
 * 一条，同一天再打卡是更新。
 */

export interface MoodEntry {
    id: string;
    createdAt: string;
    userId: string;
    /** YYYY-MM-DD */
    date: string;
    /** 1(低落) – 5(很好) */
    mood: number;
    note: string | null;
}

export interface MoodBoard {
    partner: { id: string; username: string; displayName: string };
    mine: MoodEntry[];
    theirs: MoodEntry[];
}

export function fetchMoodBoard(): Promise<MoodBoard> {
    return api.get<MoodBoard>('/moods');
}

export function checkInMood(
    mood: number,
    note?: string | null,
    date?: string,
): Promise<MoodBoard> {
    return api.put<MoodBoard>('/moods', { mood, note: note ?? null, date });
}
