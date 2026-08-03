'use client';

import { Check, X } from 'lucide-react';
import styles from './LocalApprovalCard.module.css';

/**
 * 「它想动你的文件 / 跑条命令」的确认卡片，长在宠物气泡里。
 *
 * ## 为什么从系统弹窗改成这个
 *
 * 原生弹窗把「宠物在跟你说话」这件事打断成两个割裂的界面——一个圆头圆脑的
 * 气泡，和一个突然盖上来的系统模态框。而且模态框会抢走整个应用的焦点，
 * 你正在打的字都得等它。
 *
 * ## 放在网页里安全吗——安全，但前提写在这儿
 *
 * 一开始我认为不安全：「让被审查的一方自己画审查界面没有意义」。
 * 后来想清楚了，**被审查的是模型，不是页面代码**，而模型进不了页面：
 *
 * 1. 卡片内容（路径、预览）**由 Rust 算出来**，不是模型说什么就显示什么；
 * 2. 将要写下去的内容存在 Rust 的 PENDING_APPROVALS 里，网页层只拿得到一个
 *    id——它改不了内容，只能把 id 递回去；
 * 3. 模型的输出渲染成 Markdown，而那个渲染器**不接 rehype-raw、不用
 *    dangerouslySetInnerHTML**（见 Markdown.tsx），所以它伪造不出一张假卡片
 *    来骗你点。
 *
 * 这三条里任何一条塌了，这个设计就不成立。改之前先回来看一眼。
 */

export interface PendingApproval {
    id: string;
    title: string;
    path: string;
    preview: string;
    existed: boolean;
}

export default function LocalApprovalCard({
    approval,
    busy,
    onApprove,
    onReject,
}: {
    approval: PendingApproval;
    busy?: boolean;
    onApprove: () => void;
    onReject: () => void;
}) {
    return (
        <div className={styles.card} role="alertdialog" aria-label={approval.title}>
            <p className={styles.title}>{approval.title}</p>
            <p className={styles.path} title={approval.path}>{approval.path}</p>

            {/* 预览用 <pre>：这是文件内容和命令，不能按 Markdown 渲染
                ——那样 `**` 会消失、缩进会被吃掉，而你正是要照着它判断该不该同意。 */}
            <pre className={styles.preview}>{approval.preview}</pre>

            {approval.existed && (
                <p className={styles.note}>原文件会先备份，可以找回。</p>
            )}

            <div className={styles.actions}>
                <button
                    type="button"
                    className={styles.reject}
                    onClick={onReject}
                    disabled={busy}
                >
                    <X size={14} />
                    不用了
                </button>
                <button
                    type="button"
                    className={styles.approve}
                    onClick={onApprove}
                    disabled={busy}
                >
                    <Check size={14} />
                    {busy ? '执行中…' : '可以'}
                </button>
            </div>
        </div>
    );
}
