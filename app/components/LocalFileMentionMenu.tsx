'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

/**
 * `@` 候选里那些**不是本机文件**的条目——目前只有宠物。
 *
 * 做成通用的一档而不是写死一个宠物：这个菜单已经是共用组件，以后要加
 * 「@某个计划」「@某张照片」时，加数据就够了，不用再开第二个菜单。
 */
export interface MentionExtra {
    id: string;
    name: string;
    emoji: string;
    hint: string;
    /** 选中时做什么。文件那类由 hook 统一处理，这类各自决定。 */
    onPick: () => void;
}

/**
 * 菜单里的一条。**两类必须在同一个列表里**，否则会变成两个浮层互相遮挡
 * ——先渲染的那个被后渲染的盖住，用户打 `@` 只看得到文件，看不到宠物。
 */
export type MentionItem =
    | { kind: 'extra'; extra: MentionExtra }
    | { kind: 'file'; file: LocalFileCandidate };

export interface MentionController {
    query: string | null;
    /** 宠物在前、文件在后的合并列表。上下键、Enter 都跨着这一个列表走。 */
    items: MentionItem[];
    activeIndex: number;
    busyPath: string | null;
    /** 挂在输入框的 onChange / onKeyUp / onClick 上，跟踪光标位置。 */
    sync: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
    /** 挂在输入框的 onKeyDown 上。**返回 true 表示这个键已经被菜单吃掉了**，
     *  调用方就不要再当成「发送」处理——否则选候选的那个 Enter 会把消息也发出去。 */
    handleKeyDown: (event: KeyboardEvent) => boolean;
    dismiss: () => void;
    pick: (item: MentionItem) => void;
    setActiveIndex: (index: number) => void;
}

export function useLocalFileMention(
    onPicked: (file: File) => void | Promise<void>,
    onError?: (message: string) => void,
    /**
     * 按当前输入给出**非文件**候选（宠物）。
     *
     * 传函数而不是数组：query 是这个 hook 自己算的，调用方拿不到它，
     * 传数组就会变成「调用方自己再算一遍光标前那截字」——两份实现迟早分叉。
     */
    extrasFor?: (query: string) => MentionExtra[],
): MentionController {
    const [query, setQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [busyPath, setBusyPath] = useState<string | null>(null);
    const candidates = useLocalFileCandidates(query);
    /**
     * 宠物在前、文件在后。
     *
     * **`extrasFor` 必须进依赖。** 我第一版把它塞进 ref 并只盯 `[query, candidates]`
     * ——那样宠物改了名字之后，菜单里还挂着旧名字，直到你多打一个字才刷新。
     * 这正是这一版在别处修的那个毛病（改名不跨窗口生效），别在这儿再造一个。
     * 调用方用 useCallback 把它按宠物名字缓存，所以只有真的改名时才会重算。
     */
    const items: MentionItem[] = useMemo(() => {
        const extras = query === null ? [] : (extrasFor?.(query) ?? []);
        return [
            ...extras.map(extra => ({ kind: 'extra' as const, extra })),
            ...candidates.map(file => ({ kind: 'file' as const, file })),
        ];
    }, [query, candidates, extrasFor]);
    /** 最近一次同步光标时用的那个输入框。选中之后要回去把 `@…` 抹掉。 */
    const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

    // 候选换了一批就把高亮拉回第一条，否则会停在一个已经不存在的位置上。
    useEffect(() => { setActiveIndex(0); }, [query]);

    const sync = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (!element) return;
        fieldRef.current = element;
        const upto = element.value.slice(0, element.selectionStart ?? 0);
        setQuery(MENTION_AT_CARET.exec(upto)?.[1] ?? null);
    }, []);

    const dismiss = useCallback(() => setQuery(null), []);

    const pick = useCallback((item: MentionItem) => {
        setQuery(null);
        // 宠物那类由调用方自己插入 `@名字 `，不走下面抹掉 `@` 的逻辑
        // ——它要的是把半截名字补全，而不是删掉。
        if (item.kind === 'extra') {
            item.extra.onPick();
            return;
        }
        const candidate = item.file;
        setBusyPath(candidate.path);

        /**
         * **把输入框里那截 `@…` 删掉。**
         *
         * 少了这一步会很怪：`setQuery(null)` 只是把菜单收起来，而 `@` 还留在
         * 文本里——紧接着的 keyup 会再跑一次 `sync`，从文本里重新算出这个 `@`，
         * 菜单**立刻又弹回来，高亮还回到第一条**。用户看到的是「我选了 b.txt，
         * 结果传上去的是第一个文件」，因为他下一次按键选中的其实是重开的菜单。
         *
         * 用原生 setter + input 事件，而不是直接改 element.value：
         * 输入框的值是 React 受控的，直接改 DOM 会在下次渲染被覆盖回去。
         */
        const field = fieldRef.current;
        if (field) {
            const caret = field.selectionStart ?? field.value.length;
            const at = field.value.slice(0, caret).lastIndexOf('@');
            if (at >= 0) {
                const next = field.value.slice(0, at) + field.value.slice(caret);
                const proto = field instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, 'value')!
                    .set!.call(field, next);
                field.dispatchEvent(new Event('input', { bubbles: true }));
                requestAnimationFrame(() => {
                    field.focus();
                    field.setSelectionRange(at, at);
                });
            }
        }
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
        if (query === null || items.length === 0) return false;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setActiveIndex(index => (index + 1) % items.length);
                return true;
            case 'ArrowUp':
                event.preventDefault();
                setActiveIndex(index => (index - 1 + items.length) % items.length);
                return true;
            case 'Enter':
            case 'Tab': {
                // **必须 preventDefault 并告诉调用方「这个键我用了」。**
                // 不然选中候选的同一个 Enter 会顺手把消息发出去，
                // 而那条消息里还带着半截 `@日记` 的文字。
                event.preventDefault();
                const chosen = items[activeIndex];
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
    }, [query, items, activeIndex, pick, dismiss]);

    return {
        query, items, activeIndex, busyPath,
        sync, handleKeyDown, dismiss, pick, setActiveIndex,
    };
}

export default function LocalFileMentionMenu({ controller }: { controller: MentionController }) {
    const { items, activeIndex, busyPath, pick, setActiveIndex } = controller;
    if (items.length === 0) return null;

    return (
        <div className={styles.menu} role="listbox" aria-label="可以叫的和这台电脑上的文件">
            {items.map((item, index) => {
                const active = index === activeIndex;
                const key = item.kind === 'extra' ? `x:${item.extra.id}` : `f:${item.file.path}`;
                // 鼠标划过就跟着高亮，免得键盘选到第三条、鼠标又停在第一条上，
                // 两个「当前项」互相打架。
                // onMouseDown 而不是 onClick：输入框失焦会先把菜单关掉，
                // 等到 click 时这个按钮已经不在了。
                const shared = {
                    type: 'button' as const,
                    role: 'option',
                    'aria-selected': active,
                    'data-active': active || undefined,
                    className: styles.item,
                    onMouseEnter: () => setActiveIndex(index),
                    onMouseDown: (event: React.MouseEvent) => {
                        event.preventDefault();
                        pick(item);
                    },
                };

                if (item.kind === 'extra') {
                    return (
                        <button key={key} {...shared}>
                            <span aria-hidden="true">{item.extra.emoji}</span>
                            <span className={styles.name}>{item.extra.name}</span>
                            <span className={styles.hint}>{item.extra.hint}</span>
                        </button>
                    );
                }
                return (
                    <button key={key} {...shared} title={item.file.path} disabled={busyPath !== null}>
                        <Paperclip size={13} aria-hidden="true" />
                        <span className={styles.name}>{item.file.name}</span>
                        <span className={styles.hint}>
                            {busyPath === item.file.path ? '读取中…' : formatSize(item.file.size)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
