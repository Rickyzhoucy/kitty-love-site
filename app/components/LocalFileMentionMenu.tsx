'use client';

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
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
 * ## 为什么做成共用的 hook + 组件
 *
 * 站里有**两个**能跟宠物说话的输入框：私聊页 `/chat`，和宠物自己的对话面板。
 * 第一版只给了前者，结果在宠物面板里打 `@日记` 什么都不弹——「聊天」这个词
 * 在这个站里本来就指两个地方，抄第二遍的话迟早又漏第三个。
 *
 * ## 键盘必须能用
 *
 * 补全菜单只能用鼠标点，就不是补全，是个下拉框。打 `@` 的人手在键盘上，
 * 让他去摸鼠标等于把省下的时间又还回去。上下键选、Enter/Tab 确认、Esc 关掉。
 *
 * ## 选中之后是附件，不是往消息里插路径
 *
 * 理由见 lib/localFileMention.ts：私聊里的宠物拿不到本地文件工具，
 * 而「你亲手选的这个文件」的授权语义也比「模型自己决定读哪个」清楚。
 */

/** 光标前那个还没打完的 `@xxx`。 */
export const MENTION_AT_CARET = /@([^\s@]{0,24})$/;

export interface MentionController {
    query: string | null;
    candidates: LocalFileCandidate[];
    activeIndex: number;
    busyPath: string | null;
    /** 挂在输入框的 onChange / onKeyUp / onClick 上，跟踪光标位置。 */
    sync: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
    /** 挂在输入框的 onKeyDown 上。**返回 true 表示这个键已经被菜单吃掉了**，
     *  调用方就不要再当成「发送」处理——否则选候选的那个 Enter 会把消息也发出去。 */
    handleKeyDown: (event: KeyboardEvent) => boolean;
    dismiss: () => void;
    pick: (candidate: LocalFileCandidate) => void;
    setActiveIndex: (index: number) => void;
}

export function useLocalFileMention(
    onPicked: (file: File) => void | Promise<void>,
    onError?: (message: string) => void,
): MentionController {
    const [query, setQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [busyPath, setBusyPath] = useState<string | null>(null);
    const candidates = useLocalFileCandidates(query);

    // 候选换了一批就把高亮拉回第一条，否则会停在一个已经不存在的位置上。
    useEffect(() => { setActiveIndex(0); }, [query]);

    const sync = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (!element) return;
        const upto = element.value.slice(0, element.selectionStart ?? 0);
        setQuery(MENTION_AT_CARET.exec(upto)?.[1] ?? null);
    }, []);

    const dismiss = useCallback(() => setQuery(null), []);

    const pick = useCallback((candidate: LocalFileCandidate) => {
        setBusyPath(candidate.path);
        setQuery(null);
        void (async () => {
            try {
                const file = await readLocalFileForUpload(candidate.path);
                await onPicked(file);
            } catch (reason) {
                onError?.(reason instanceof Error ? reason.message : String(reason));
            } finally {
                setBusyPath(null);
            }
        })();
    }, [onPicked, onError]);

    const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
        if (query === null || candidates.length === 0) return false;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setActiveIndex(index => (index + 1) % candidates.length);
                return true;
            case 'ArrowUp':
                event.preventDefault();
                setActiveIndex(index => (index - 1 + candidates.length) % candidates.length);
                return true;
            case 'Enter':
            case 'Tab': {
                // **必须 preventDefault 并告诉调用方「这个键我用了」。**
                // 不然选中候选的同一个 Enter 会顺手把消息发出去，
                // 而那条消息里还带着半截 `@日记` 的文字。
                event.preventDefault();
                const chosen = candidates[activeIndex];
                if (chosen) pick(chosen);
                return true;
            }
            case 'Escape':
                event.preventDefault();
                // 只关候选，不关外面的面板——不然取消一次误触发的 @
                // 得把整个对话框重开一遍。
                event.stopPropagation();
                dismiss();
                return true;
            default:
                return false;
        }
    }, [query, candidates, activeIndex, pick, dismiss]);

    return {
        query, candidates, activeIndex, busyPath,
        sync, handleKeyDown, dismiss, pick, setActiveIndex,
    };
}

export default function LocalFileMentionMenu({ controller }: { controller: MentionController }) {
    const { candidates, activeIndex, busyPath, pick, setActiveIndex } = controller;
    if (candidates.length === 0) return null;

    return (
        <div className={styles.menu} role="listbox" aria-label="这台电脑上的文件">
            {candidates.map((candidate, index) => (
                <button
                    key={candidate.path}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex || undefined}
                    className={styles.item}
                    title={candidate.path}
                    disabled={busyPath !== null}
                    // 鼠标划过就跟着高亮，免得键盘选到第三条、鼠标又停在第一条上，
                    // 两个「当前项」互相打架。
                    onMouseEnter={() => setActiveIndex(index)}
                    // onMouseDown 而不是 onClick：输入框失焦会先把菜单关掉，
                    // 等到 click 时这个按钮已经不在了。
                    onMouseDown={event => {
                        event.preventDefault();
                        pick(candidate);
                    }}
                >
                    <Paperclip size={13} aria-hidden="true" />
                    <span className={styles.name}>{candidate.name}</span>
                    <span className={styles.hint}>
                        {busyPath === candidate.path ? '读取中…' : formatSize(candidate.size)}
                    </span>
                </button>
            ))}
        </div>
    );
}
