'use client';

import { useRef, useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import Markdown from '../Markdown';
import styles from './FloatingPet.module.css';

/**
 * 宠物说的话。
 *
 * ## 设计命题：这是它递给你的一张纸条，不是一个日志窗口
 *
 * 改造前是一个固定 300px 宽、固定高、右上角悬着的白盒子，配一条粉色滚动条。
 * 同一个盒子要装两种东西：一句「喵～在呢」，和一段四百字的带标题带列表的
 * 回答。结果两头都难看——短句被撑成一个空荡荡的框，长答案被压成一个猫眼。
 *
 * 所以这一版的三条：
 *
 * **一、跟着内容长。** 宽度 `fit-content`，短句就只有短句那么宽；长了才撑到
 * 上限换行。高度同理，超过上限才出现滚动，而不是一上来就留一条滚动条的位置。
 *
 * **二、连在宠物身上。** 底下有个小尖角指向宠物，并且**跟着宠物换边**——
 * 它被拖到屏幕左边时尖角在左，右边时在右。原来的版本永远右对齐，宠物走到左边
 * 之后气泡就往屏幕外面伸。尖角是这套设计里唯一「花」的地方，其余都保持安静：
 * 它做的事是让这段话读起来像「猫说的」，而不是「弹出了一个通知」。
 *
 * **三、渲染 Markdown。** 模型的输出本来就是 Markdown，原样当纯文本显示，
 * 用户看到的就是满屏的 `**`——截图里正是如此。
 */

export default function SpeechBubble({
    text,
    petName,
    petEmoji,
    /** 宠物在屏幕的哪半边。尖角要指向宠物，所以跟着它走。 */
    side,
    onClose,
    onReply,
    sending = false,
}: {
    text: string;
    petName: string;
    petEmoji: string;
    side: 'left' | 'right';
    onClose: () => void;
    /**
     * 直接回这句话。**不传就不显示回复框**——几秒就消失的状态提示
     * （「正在查…」）挂个输入框没有意义。
     */
    onReply?: (text: string) => void;
    /** 它还在说（流式输出中）。这时候不该让人回，那句话还没说完。 */
    sending?: boolean;
}) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const submit = () => {
        const value = draft.trim();
        if (!value || sending) return;
        setDraft('');
        onReply?.(value);
    };

    return (
        <div className={styles.speech} data-side={side} data-pet-overlay role="status">
            {/* 署名行。用衬线排名字，让它读起来像一句话的落款，而不是一个
                控件标题——这个站里衬线体一直是「有人在说话」的信号。
                关闭按钮并进这一行，不再单独占一列。 */}
            <div className={styles.speechHead}>
                <span className={styles.speechAvatar} aria-hidden="true">{petEmoji}</span>
                <span className={styles.speechName}>{petName}</span>
                <button
                    type="button"
                    className={styles.speechClose}
                    onClick={onClose}
                    aria-label="收起"
                >
                    <X size={13} />
                </button>
            </div>

            <div className={styles.speechScroll}>
                <Markdown content={text} className={styles.speechBody} />
            </div>

            {/* 直接回这一条。
                **这里刻意不做成聊天记录。** 上面那段话就是上下文，回完之后
                气泡里换成它的新回复——一来一回都在同一张纸条上。要翻完整的
                来往，那是对话本该干的事。 */}
            {onReply && (
                <div className={styles.speechReply}>
                    <input
                        ref={inputRef}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                submit();
                            }
                            // 别让空格、方向键这些冒泡出去被别的处理器吃掉
                            // ——宠物窗口那边有全局按键行为。
                            event.stopPropagation();
                        }}
                        placeholder={sending ? '它还在说…' : '回一句…'}
                        aria-label={`回复 ${petName}`}
                        disabled={sending}
                        className={styles.speechReplyInput}
                    />
                    <button
                        type="button"
                        onClick={submit}
                        disabled={sending || !draft.trim()}
                        aria-label="发送"
                        className={styles.speechReplySend}
                    >
                        <CornerDownLeft size={14} />
                    </button>
                </div>
            )}

            {/* 尖角。两层：外层是描边色、里层是底色，叠出「有边框的尖角」，
                而不是一个描边被截断的三角形。 */}
            <span className={styles.speechTail} data-pet-speech-tail aria-hidden="true">
                <span className={styles.speechTailFill} />
            </span>
        </div>
    );
}
