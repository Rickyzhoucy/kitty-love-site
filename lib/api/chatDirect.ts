'use client';

import { api } from './client';

/**
 * 双人私聊（计划文档 §3）。
 *
 * 与 `resources.ts` 里的 `messagesApi`（留言板）是两回事：那个是公开留言，
 * 这个是两个人之间的私信，有收发双方和已读状态。
 */

export interface DirectMessage {
    id: string;
    createdAt: string;
    senderId: string;
    recipientId: string;
    body: string;
    attachmentIds: string[];
    /** null 表示还没被打开。宠物的中介行为全以它为唯一依据。 */
    readAt: string | null;
    /** 这条在回复哪一条。原消息被删掉时会变回 null（外键 SET NULL）。 */
    replyToId: string | null;
    /** 这条是一张表情：无气泡、固定尺寸、GIF 会动。 */
    sticker: boolean;
}

/** 宠物在聊天流里说的话。**必须与真人消息视觉上明确区分**（§3.2）。 */
export interface PetInterjection {
    id: string;
    createdAt: string;
    kind: 'unread_nudge' | 'standin' | 'company' | string;
    body: string;
    messageId: string | null;
    /**
     * 说这句话的那只宠物。
     *
     * **由服务端给，不要拿本地那只顶上。** 两个人各有一只宠物，这边只知道
     * 自己那只；靠本地猜的结果是同一条插话在两个人屏幕上挂着不同的名字。
     * 旧数据没有归属，这里是 null，显示时回退到中性称呼。
     */
    speakerName: string | null;
    speakerAssetId: string | null;
}

export interface Partner {
    id: string;
    username: string;
    displayName: string;
    /** 对方那只宠物叫什么。用来判断一条消息是不是在叫**对方的**宠物。 */
    petName: string | null;
}

export interface ChatThread {
    partner: Partner;
    messages: DirectMessage[];
    interjections: PetInterjection[];
    unreadCount: number;
}

export function fetchThread(): Promise<ChatThread> {
    return api.get<ChatThread>('/chat/thread');
}

export function sendDirectMessage(
    body: string,
    attachmentIds: string[] = [],
    replyToId: string | null = null,
    sticker = false,
): Promise<DirectMessage> {
    return api.post<DirectMessage>(
        '/chat/messages', { body, attachmentIds, replyToId, sticker },
    );
}

/** 标为已读。调用后宠物的唠叨会立刻停——「打开了就安静」。 */
export function markChatRead(): Promise<void> {
    return api.post<void>('/chat/read');
}

/**
 * 跑一轮宠物中介。返回这一轮新增的插话。
 *
 * 由页面定时调用，**不是一个新的通知渠道**——所有输出都受深夜静默与
 * initiative 三档约束，服务端会再拦一次。
 */
export function runMediation(
    initiative: 'normal' | 'quiet' | 'off',
): Promise<PetInterjection[]> {
    return api.post<PetInterjection[]>(
        `/chat/mediate?initiative=${encodeURIComponent(initiative)}`,
    );
}
