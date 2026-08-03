'use client';

import { useCallback, useState } from 'react';
import { Paperclip } from 'lucide-react';
import {
    formatSize,
    readLocalFileForUpload,
    useLocalFileCandidates,
    type LocalFileCandidate,
} from '@/lib/localFileMention';
import styles from './LocalFileMentionMenu.module.css';

/**
 * 输入框里打 `@` 时弹出的本机文件候选。
 *
 * ## 为什么做成共用组件
 *
 * 站里有**两个**能跟宠物说话的输入框：私聊页 `/chat`，和宠物自己的对话面板。
 * 第一版只给了前者，结果用户在宠物面板里打 `@日记` 什么都没弹出来——
 * 「聊天」这个词在这个站里本来就指两个地方，抄第二遍的话迟早又漏第三个。
 *
 * ## 选中之后是附件，不是往消息里插路径
 *
 * 理由见 lib/localFileMention.ts。简单说：私聊里的宠物拿不到本地文件工具，
 * 而「你亲手选的这个文件」的授权语义也比「模型自己决定读哪个」清楚。
 */

/** 光标前那个还没打完的 `@xxx`。与 /chat 页那条规则保持一致。 */
export const MENTION_AT_CARET = /@([^\s@]{0,24})$/;

export function useMentionQuery() {
    const [query, setQuery] = useState<string | null>(null);
    /** 光标动了就重算——只在 onChange 里判断的话，用方向键移出去候选会赖着不走。 */
    const sync = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (!element) return;
        const upto = element.value.slice(0, element.selectionStart ?? 0);
        setQuery(MENTION_AT_CARET.exec(upto)?.[1] ?? null);
    }, []);
    return { query, setQuery, sync };
}

export default function LocalFileMentionMenu({
    query,
    onPicked,
    onError,
}: {
    query: string | null;
    /** 文件已读成可上传的 File。调用方负责把它塞进自己的附件槽。 */
    onPicked: (file: File) => void | Promise<void>;
    onError?: (message: string) => void;
}) {
    const candidates = useLocalFileCandidates(query);
    const [busy, setBusy] = useState<string | null>(null);

    if (candidates.length === 0) return null;

    const pick = async (candidate: LocalFileCandidate) => {
        setBusy(candidate.path);
        try {
            const file = await readLocalFileForUpload(candidate.path);
            await onPicked(file);
        } catch (reason) {
            onError?.(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.menu} role="listbox" aria-label="这台电脑上的文件">
            {candidates.map(candidate => (
                <button
                    key={candidate.path}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={styles.item}
                    title={candidate.path}
                    disabled={busy !== null}
                    // onMouseDown 而不是 onClick：输入框失焦会先把菜单关掉，
                    // 等到 click 时这个按钮已经不在了。
                    onMouseDown={event => {
                        event.preventDefault();
                        void pick(candidate);
                    }}
                >
                    <Paperclip size={13} aria-hidden="true" />
                    <span className={styles.name}>{candidate.name}</span>
                    <span className={styles.hint}>
                        {busy === candidate.path ? '读取中…' : formatSize(candidate.size)}
                    </span>
                </button>
            ))}
        </div>
    );
}
