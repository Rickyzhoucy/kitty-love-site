'use client';

import { useRef, useState } from 'react';
import { Mic, Trash2 } from 'lucide-react';
import { useVoiceRecorder, type VoiceClip } from '@/lib/useVoiceRecorder';
import styles from './page.module.css';

/**
 * 按住说话。
 *
 * ## 上滑取消，而不是「再点一次取消」
 *
 * 按住的时候手已经在按钮上了，往上滑是最省的取消动作——微信这么做是有道理的：
 * 说错话那一刻你想的是「别发出去」，此时再去找一个取消按钮太慢。
 *
 * ## 为什么用 pointer 事件而不是 mouse/touch
 *
 * 一套事件同时覆盖鼠标、触屏和触控板。`setPointerCapture` 让手指/指针滑出
 * 按钮范围后仍然收得到 move 和 up——不捕获的话，上滑到按钮外面就再也收不到
 * `pointerup`，录音会一直录下去。
 */

/** 往上滑多少像素算取消。太小会误触，太大在小窗口里滑不到。 */
const CANCEL_DISTANCE = 60;

export default function VoiceButton({
    onRecorded,
    disabled,
    onError,
}: {
    onRecorded: (clip: VoiceClip) => void;
    disabled?: boolean;
    onError: (message: string) => void;
}) {
    const recorder = useVoiceRecorder();
    const [willCancel, setWillCancel] = useState(false);
    const startYRef = useRef(0);

    const finish = async (cancelled: boolean) => {
        setWillCancel(false);
        if (cancelled) {
            recorder.cancel();
            return;
        }
        const { clip, error } = await recorder.stop();
        if (clip) onRecorded(clip);
        else if (error) onError(error);
    };

    return (
        <>
            {/* 录音中的浮层。**盖住半屏**是故意的：正在录音是个独占状态，
                这时候点别的东西都没有意义，不如把它说清楚。 */}
            {(recorder.recording || recorder.starting) && (
                <div className={styles.recordingOverlay} role="status">
                    <div className={willCancel ? styles.recordingCancel : styles.recordingLive}>
                        {willCancel ? <Trash2 size={22} /> : <Mic size={22} />}
                    </div>
                    <span className={styles.recordingTime}>
                        {recorder.starting ? '…' : `${recorder.elapsed.toFixed(1)}s`}
                    </span>
                    <span className={styles.recordingHint}>
                        {recorder.starting
                            ? '等麦克风授权…'
                            : willCancel ? '松手取消' : '上滑取消'}
                    </span>
                </div>
            )}

            <button
                type="button"
                className={`${styles.attachButton} ${styles.voiceButton} ${
                    recorder.recording || recorder.starting ? styles.voiceActive : ''
                }`}
                disabled={disabled}
                aria-label="按住说话"
                title="按住说话"
                onPointerDown={event => {
                    event.preventDefault();
                    // 捕获指针：滑出按钮范围后仍然收得到 move / up，
                    // 否则上滑到外面就再也收不到 pointerup，会一直录下去。
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startYRef.current = event.clientY;
                    // 用返回值判断，不读 recorder.error——那是本次渲染的旧闭包，
                    // start() 里 setState 之后它还是 null，权限被拒会毫无提示。
                    void recorder.start().then(message => {
                        if (message) onError(message);
                    });
                }}
                onPointerMove={event => {
                    if (!recorder.recording) return;
                    setWillCancel(startYRef.current - event.clientY > CANCEL_DISTANCE);
                }}
                onPointerUp={() => void finish(willCancel)}
                // 指针被系统抢走（来电、切应用）时当作取消，不要留一个
                // 永远录下去的会话。
                onPointerCancel={() => void finish(true)}
            >
                <Mic size={18} />
            </button>
        </>
    );
}
