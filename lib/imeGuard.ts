'use client';

import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * 「回车发送」在输入法下的护栏。
 *
 * ## 问题
 *
 * 中日韩输入法里，回车常常是**上屏键**——把候选词确认到输入框，而不是「我说完了」。
 * 没有护栏的话，用户敲拼音、按回车选词，这一下就把半句话发出去了。
 *
 * ## 为什么一个判断不够
 *
 * 浏览器给了 `KeyboardEvent.isComposing` 表示「这一下属于输入法组词过程」，
 * 但三家实现互相不一致，得叠三层：
 *
 * 1. **`isComposing`** —— 标准答案，Chrome / Firefox 正常。
 * 2. **`keyCode === 229`** —— 有些情况下 `isComposing` 是 false，但 keyCode 仍是
 *    229（输入法已处理）。Android 上的中文输入法尤其常见。
 * 3. **刚结束组词的那一瞬** —— Safari 把 `compositionend` 排在 `keydown`
 *    **前面**（其它浏览器相反）。等到 keydown 时 `isComposing` 已经变回 false、
 *    keyCode 也不是 229 了，前两层全都拦不住，而这一下正是上屏那个回车。
 *
 * 第三层用一个「刚刚结束」标志，并用 `setTimeout(…, 0)` 清掉：Safari 的 keydown
 * 紧跟在 compositionend 之后同一轮事件里派发，宏任务一到就说明那一下已经过去了。
 * **不用固定毫秒数**——那种阈值在慢机器上会误伤真正的发送。
 *
 * ## 用法
 *
 * ```tsx
 * const ime = useImeGuard();
 * <input
 *   {...ime.handlers}
 *   onKeyDown={event => {
 *     if (event.key === 'Enter' && !ime.isComposing(event)) send();
 *   }}
 * />
 * ```
 *
 * 参考：MDN keydown / isComposing，以及 Safari 事件顺序相反这个长期问题。
 */
export function useImeGuard() {
    const composing = useRef(false);
    const justEnded = useRef(false);

    const onCompositionStart = useCallback(() => {
        composing.current = true;
    }, []);

    const onCompositionEnd = useCallback(() => {
        composing.current = false;
        // Safari 的上屏回车会在这之后才到 keydown，留个标志让它也被拦下。
        justEnded.current = true;
        setTimeout(() => {
            justEnded.current = false;
        }, 0);
    }, []);

    const isComposing = useCallback((event: ReactKeyboardEvent) => {
        const native = event.nativeEvent as unknown as {
            isComposing?: boolean;
            keyCode?: number;
        };
        return (
            composing.current
            || justEnded.current
            || native.isComposing === true
            || native.keyCode === 229
        );
    }, []);

    return {
        /** 摊到输入框上，用来跟踪组词的起止。 */
        handlers: { onCompositionStart, onCompositionEnd },
        /** 这一下回车是不是输入法在上屏。是就别当成「发送」。 */
        isComposing,
    };
}
