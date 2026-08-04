'use client';

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/lib/api/client';
import styles from './page.module.css';

/**
 * 聊天流里的一条语音，照微信那种。
 *
 * ## 为什么不用原生 `<audio controls>`
 *
 * 因为它显示「--:--」。webm 是流式容器**不写总时长**，浏览器读 `duration`
 * 得到 NaN——一条正常的语音看着像坏文件（重开页面后尤其明显：首次录完那次
 * 内存里还有时长，刷新之后就只剩容器里那个空值了）。
 *
 * 而且原生控件那一整条播放器摆在聊天流里也太重：语音消息要的是「点一下就响」，
 * 不是拖进度条。
 *
 * 时长在录的时候就算好了，写进文件名（见 lib/useVoiceRecorder.ts）。从文件名
 * 读回来，所以任何容器格式下都对，刷新也还在。
 *
 * ## 抄微信的三个细节
 *
 * 1. **气泡宽度跟时长走** —— 一眼看出这条是长是短，不用先播。
 * 2. **三道弧线，播放时依次亮** —— 静止时也是喇叭的形状，不需要图例。
 * 3. **时长标在气泡外面** —— 标里面会挤掉本来就不多的宽度。
 */
function secondsFromName(filename: string): number | null {
    const matched = /-(\d+)s\.[a-z0-9]+$/i.exec(filename);
    if (!matched) return null;
    const value = Number(matched[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

export default function VoiceBubble({
    src,
    filename,
    mine,
}: {
    src: string;
    filename: string;
    mine: boolean;
}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const total = secondsFromName(filename);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const stop = () => setPlaying(false);
        audio.addEventListener('ended', stop);
        audio.addEventListener('pause', stop);
        return () => {
            audio.removeEventListener('ended', stop);
            audio.removeEventListener('pause', stop);
        };
    }, []);

    const toggle = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (playing) {
            audio.pause();
            return;
        }
        // 从头播。听完再点一次是「再听一遍」，不是「从上次停的地方继续」
        // ——一条几秒的语音没有续播的必要。
        audio.currentTime = 0;
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };

    // 宽度跟时长走。上下限都夹住，免得一条 60 秒的把整行撑满。
    const width = total ? Math.min(200, 76 + total * 5) : 96;

    return (
        <span className={`${styles.voiceRow} ${mine ? styles.voiceRowMine : ''}`}>
            <button
                type="button"
                className={`${styles.voiceBubble} ${mine ? styles.voiceMine : ''}`}
                style={{ width }}
                onClick={toggle}
                aria-label={total ? `语音 ${total} 秒${playing ? '，正在播放' : ''}` : '语音'}
            >
                <span
                    className={styles.voiceIcon}
                    data-playing={playing ? 'true' : undefined}
                    aria-hidden="true"
                >
                    <i /><i /><i />
                </span>
            </button>
            <span className={styles.voiceLength}>{total ? `${total}″` : '语音'}</span>
            <audio ref={audioRef} src={apiUrl(src)} preload="none" />
        </span>
    );
}
