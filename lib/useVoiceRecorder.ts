'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * 按住说话。
 *
 * ## 编码格式不能写死
 *
 * `MediaRecorder` 在不同引擎里支持的容器不一样：Chrome 给 webm/opus，
 * 而 Safari（也就是桌面版那个 WKWebView）**根本不支持 webm**，只给 mp4/aac。
 * 写死 `mimeType: 'audio/webm'` 的结果是在桌面端构造 MediaRecorder 就抛异常。
 * 所以这里按优先级探测，全都不支持就把选择权交还给浏览器（传空让它自己定）。
 *
 * ## 为什么要自己记时长
 *
 * 录完立刻读 `audio.duration` 在 webm 上经常是 `Infinity`——流式容器没有写入
 * 总时长。等元数据、seek 到末尾再读那套 hack 不稳。自己按开始/结束时间算，
 * 简单且一定对。
 *
 * ## 取消要真的丢掉
 *
 * 上滑取消不能只是「不发送」：录音轨还开着的话，麦克风指示灯会一直亮，
 * 用户会以为还在录。`stop()` 之后必须把每条 track 也 stop 掉。
 */

/** 按优先级挑一个这台机器录得出来的格式。 */
function pickMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        // Safari / WKWebView 只有这一档
        'audio/mp4',
        'audio/mpeg',
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

export interface VoiceClip {
    file: File;
    /** 秒，自己算的，不读 audio.duration。 */
    seconds: number;
}

export interface VoiceRecorder {
    recording: boolean;
    /**
     * 正在等麦克风授权。
     *
     * `getUserMedia` 在等用户点「允许」时是**一直挂着**的——既不 resolve 也不
     * reject。没有这个状态的话，从按下去到授权框出现之间界面毫无变化，
     * 和「坏了」分不出来（实测在无法弹框的环境里它就是永远挂着）。
     */
    starting: boolean;
    /** 已经录了多少秒，用来显示计时。 */
    elapsed: number;
    error: string | null;
    /**
     * 开始录。**出错时把消息 return 出去，而不是只写进 state。**
     *
     * 只写 state 的话调用方拿不到：它手上的 `recorder.error` 是本次渲染那个
     * 闭包里的旧值，`start()` 里 setState 之后它还是 null——于是权限被拒时
     * 用户什么提示都看不到，只觉得「按了没反应」。返回值没有这个问题。
     */
    start: () => Promise<string | null>;
    /** 停下。`clip` 为空时 `error` 说明原因（太短 / 被取消）。 */
    stop: () => Promise<{ clip: VoiceClip | null; error: string | null }>;
    cancel: () => void;
}

export function useVoiceRecorder(): VoiceRecorder {
    const [recording, setRecording] = useState(false);
    const [starting, setStarting] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cancelledRef = useRef(false);
    /**
     * 按下之后、麦克风还没开好之前就松手了。
     *
     * `getUserMedia` 要几百毫秒才把设备交出来。这段时间里松手的话，`stop()`
     * 看到 recorderRef 还是 null 就直接返回了——而随后 recorder 照常启动，
     * **麦克风一直开着录下去**，系统的录音指示灯也一直亮。用一个标志让
     * start() 收尾时发现「其实已经不要了」并立刻释放。
     */
    const abandonedRef = useRef(false);

    /** 把麦克风真的关掉。不做这一步，系统的录音指示灯会一直亮着。 */
    const releaseMic = useCallback(() => {
        recorderRef.current?.stream.getTracks().forEach(track => track.stop());
        recorderRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setRecording(false);
        setStarting(false);
        setElapsed(0);
    }, []);

    const start = useCallback(async (): Promise<string | null> => {
        setError(null);
        cancelledRef.current = false;
        abandonedRef.current = false;
        setStarting(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            chunksRef.current = [];
            recorder.ondataavailable = event => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };
            if (abandonedRef.current) {
                // 麦克风开好之前人已经松手了。别启动，直接把设备还回去。
                stream.getTracks().forEach(track => track.stop());
                setStarting(false);
                return null;
            }
            recorder.start();
            recorderRef.current = recorder;
            setStarting(false);
            startedAtRef.current = Date.now();
            setRecording(true);
            setElapsed(0);
            timerRef.current = setInterval(() => {
                setElapsed((Date.now() - startedAtRef.current) / 1000);
            }, 200);
            return null;
        } catch (reason) {
            // 把系统级拒绝翻译成人话。`NotAllowedError` 在打包版里通常意味着
            // Info.plist 少了 NSMicrophoneUsageDescription，或者用户在系统
            // 设置里关掉了麦克风权限——两种都不是「再点一次」能解决的。
            const name = (reason as { name?: string })?.name;
            const message = name === 'NotAllowedError'
                ? '没有麦克风权限。到「系统设置 → 隐私与安全性 → 麦克风」里打开。'
                : name === 'NotFoundError'
                    ? '没找到麦克风。'
                    : '录音没能开始。';
            setError(message);
            releaseMic();
            return message;
        }
    }, [releaseMic]);

    const stop = useCallback(async (): Promise<{
        clip: VoiceClip | null;
        error: string | null;
    }> => {
        const recorder = recorderRef.current;
        if (!recorder) {
            // 还没开好就松手了：标记一下，让 start() 收尾时把麦克风还回去。
            abandonedRef.current = true;
            setStarting(false);
            return { clip: null, error: null };
        }
        const seconds = (Date.now() - startedAtRef.current) / 1000;

        const blob = await new Promise<Blob>(resolve => {
            recorder.onstop = () => {
                resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
            };
            recorder.stop();
        });
        releaseMic();

        if (cancelledRef.current) return { clip: null, error: null };

        /**
         * 下限只用来挡**误触**，不是「说得太短」。
         *
         * 原来是 1 秒，实际体感却像两秒才发得出去——因为**计时是从麦克风
         * 真正打开那一刻起的**，而 `getUserMedia` 交出设备要几百毫秒、首次
         * 授权更久。按住两秒、前一秒半在开麦克风，真正录到的就只有半秒。
         *
         * 「嗯」「好」这种一个字本来就是零点几秒，不该发不出去。所以下限压到
         * 0.25 秒——比任何一次手滑点击都长，比任何一个字都短。
         */
        if (seconds < 0.25 || blob.size === 0) {
            const message = '太短了，按住多说一会儿';
            setError(message);
            return { clip: null, error: message };
        }
        const extension = blob.type.includes('mp4') ? 'm4a'
            : blob.type.includes('mpeg') ? 'mp3'
                : 'webm';
        // **把时长写进文件名。**
        //
        // webm 是流式容器，不写总时长——浏览器读出来是 NaN，原生播放器显示
        // 「--:--」，看着像坏了。而录的时候我们本来就知道多长，让这个数跟着
        // 文件走是零成本的：附件的 filename 本来就会存下来，不用加字段。
        // 至少记 1 秒：不足一秒的语音显示「0″」看着像坏的。
        const rounded = Math.max(1, Math.round(seconds));
        return {
            clip: {
                file: new File(
                    [blob],
                    `voice-${Date.now()}-${rounded}s.${extension}`,
                    { type: blob.type },
                ),
                seconds,
            },
            error: null,
        };
    }, [releaseMic]);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        recorderRef.current?.stop();
        releaseMic();
    }, [releaseMic]);

    return { recording, starting, elapsed, error, start, stop, cancel };
}
