'use client';

import type { PendingApproval } from '@/app/components/LocalApprovalCard';

export type { PendingApproval };

/**
 * 把一次待审批的动作交给宠物气泡去问，等用户点头或拒绝。
 *
 * ## 为什么用事件而不是把状态提上去
 *
 * 发起方是执行器循环（`DesktopExecutorLoop`），显示方是宠物组件
 * （`FloatingPet`）——两者在组件树里没有父子关系，中间隔着整个页面。
 * 为这一件事拉一个 Context 出来，等于给所有页面都套一层 provider，
 * 而真正用到它的只有桌面版那一个窗口。
 *
 * **内容不经过这里。** 传的只有 Rust 给的 id 和给人看的预览文本；
 * 将要写下去的东西一直待在 Rust 的 PENDING_APPROVALS 里。
 */

const ASK_EVENT = 'kitty-local-approval';
const ANSWER_EVENT = 'kitty-local-approval-answer';

export function requestApproval(approval: PendingApproval): Promise<boolean> {
    return new Promise(resolve => {
        const onAnswer = (event: Event) => {
            const detail = (event as CustomEvent<{ id: string; approved: boolean }>).detail;
            if (detail?.id !== approval.id) return;
            window.removeEventListener(ANSWER_EVENT, onAnswer);
            resolve(detail.approved);
        };
        window.addEventListener(ANSWER_EVENT, onAnswer);
        window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: approval }));
    });
}

/** 宠物那边订阅：有事要问了。 */
export function onApprovalRequested(handler: (approval: PendingApproval) => void) {
    const listener = (event: Event) => {
        handler((event as CustomEvent<PendingApproval>).detail);
    };
    window.addEventListener(ASK_EVENT, listener);
    return () => window.removeEventListener(ASK_EVENT, listener);
}

/** 宠物那边回答。 */
export function answerApproval(id: string, approved: boolean) {
    window.dispatchEvent(
        new CustomEvent(ANSWER_EVENT, { detail: { id, approved } }),
    );
}
