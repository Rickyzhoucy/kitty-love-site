'use client';

import { api } from './client';

/**
 * 每日一问（计划文档 §2.1）。
 *
 * 核心机制：**两个人都答完才能看到对方的答案**。`partnerAnswer` 在
 * `partnerAnswered` 为 true 之前恒为 null——揭晓逻辑在服务端做，这里只是如实
 * 展示，不能靠前端自己藏起来充当锁。
 */

export type DailyQuestionCategory = 'daily' | 'memory' | 'imagine' | 'confess' | string;

export interface DailyQuestion {
    id: string;
    date: string;
    prompt: string;
    category: DailyQuestionCategory;
}

export interface DailyAnswer {
    id: string;
    createdAt: string;
    userId: string;
    body: string;
}

export interface DailyQuestionPartner {
    id: string;
    username: string;
    displayName: string;
}

export interface DailyQuestionState {
    question: DailyQuestion;
    partner: DailyQuestionPartner;
    myAnswer: DailyAnswer | null;
    partnerAnswered: boolean;
    partnerAnswer: DailyAnswer | null;
}

export function fetchDailyQuestion(): Promise<DailyQuestionState> {
    return api.get<DailyQuestionState>('/daily-question/today');
}

export function answerDailyQuestion(body: string): Promise<DailyQuestionState> {
    return api.post<DailyQuestionState>('/daily-question/answer', { body });
}
