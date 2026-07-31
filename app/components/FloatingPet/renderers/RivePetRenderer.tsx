'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alignment,
    Fit,
    Layout,
    useRive,
    type Rive,
} from '@rive-app/react-canvas';
import styles from '../FloatingPet.module.css';
import type {
    PetFacing,
    PetGaze,
    PetPersistentActivity,
    PetReaction,
    PetReactionEvent,
} from '../petBodyProtocol';

const STATE_MACHINE = 'PetSM';

/** 与 generate-canonical-rive-specs.mjs 的 ACTIVITY_VALUE 一一对应。 */
const ACTIVITY_VALUE: Record<PetPersistentActivity, number> = {
    idle: 0,
    walking: 1,
    sleeping: 2,
    held: 3,
    thinking: 4,
    working: 5,
    waiting: 6,
    asking: 7,
};

/** 语义反应 → 状态机 trigger 名。 */
const REACTION_TRIGGER: Record<PetReaction, string> = {
    celebrate: 'happy',
    success: 'success',
    fail: 'error',
    land: 'land',
    eat: 'eat',
    play: 'play',
    tapHead: 'tap-head',
    tapBody: 'tap-body',
    confused: 'confused',
};

/**
 * 状态机输入的读写封装。
 *
 * 刻意放在组件外：Rive 的输入对象是可变句柄，直接在组件里改 `.value` 会被
 * react-hooks/immutability 拦下，而那条规则针对的是 React 状态，不适用于
 * 这种指向 WASM 运行时的外部句柄。
 */
function inputOf(rive: Rive | null, name: string) {
    return rive?.stateMachineInputs(STATE_MACHINE)?.find(item => item.name === name);
}

function setInput(rive: Rive | null, name: string, value: number | boolean) {
    const input = inputOf(rive, name);
    if (input) input.value = value;
}

function fireInput(rive: Rive | null, name: string) {
    inputOf(rive, name)?.fire();
}

interface RivePetRendererProps {
    assetId: 'shiba' | 'bichon';
    source: string;
    artboard: string;
    activity: PetPersistentActivity;
    facing: PetFacing;
    /** 外层是否被 CSS 镜像了。目光取向要跟着它走，不能自己按 facing 猜。 */
    flipped: boolean;
    gaze: PetGaze;
    reaction: PetReactionEvent | null;
    className?: string;
    reducedMotion?: boolean;
    onError?: (error: Error) => void;
}

export default function RivePetRenderer({
    assetId,
    source,
    artboard,
    activity,
    facing,
    flipped,
    gaze,
    reaction,
    className,
    reducedMotion = false,
    onError,
}: RivePetRendererProps) {
    const [loaded, setLoaded] = useState(false);
    const reportedError = useRef(false);
    const lastReactionNonce = useRef<number | null>(null);
    const layout = useMemo(
        () => new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
        [],
    );
    const { rive, RiveComponent } = useRive({
        src: source,
        artboard,
        stateMachines: STATE_MACHINE,
        autoplay: true,
        layout,
        onLoad: () => setLoaded(true),
        onLoadError: () => {
            if (reportedError.current) return;
            reportedError.current = true;
            onError?.(new Error(`Rive 宠物资源加载失败：${source}`));
        },
    });

    // 活动切换。状态机按 180ms 混合过渡，这里只写一个数值——
    // 不再有 stop()/play() 造成的零过渡硬切。
    useEffect(() => {
        if (!loaded) return;
        setInput(rive, 'activity', ACTIVITY_VALUE[reducedMotion ? 'idle' : activity]);
    }, [activity, loaded, reducedMotion, rive]);

    // 目光由两个 blend1d 层连续插值，取代原来的五档离散动画。
    //
    // 被 CSS 的 scaleX(-1) 镜像时，画板的 +x 指向屏幕左边，所以 lookX 要取反。
    // 判断依据是 `flipped` 而不是 `facing`：翻不翻取决于素材自身朝哪边，由
    // PetBodyRenderer 统一算（见那里的注释）。这里自己按 facing 猜的话，
    // 换个朝向相反的素材，眼睛就会往反方向看。
    useEffect(() => {
        if (!loaded) return;
        const clamp = (value: number) => Math.max(-1, Math.min(1, value));
        setInput(rive, 'lookX', clamp(flipped ? -gaze.x : gaze.x));
        setInput(rive, 'lookY', clamp(gaze.y));
    }, [flipped, gaze.x, gaze.y, loaded, rive]);

    useEffect(() => {
        if (!loaded) return;
        setInput(rive, 'motion', !reducedMotion);
    }, [loaded, reducedMotion, rive]);

    // 一次性反应。nonce 变化即触发，状态机播完后按当前 activity 自动回位，
    // 不需要在这里用 setTimeout 猜时长。
    useEffect(() => {
        if (!loaded || !reaction || reducedMotion) return;
        if (lastReactionNonce.current === reaction.nonce) return;
        lastReactionNonce.current = reaction.nonce;
        fireInput(rive, REACTION_TRIGGER[reaction.name]);
    }, [loaded, reaction, reducedMotion, rive]);

    useEffect(() => {
        if (!loaded || reducedMotion) return;
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
            timer = setTimeout(() => {
                fireInput(rive, 'blink');
                schedule();
            }, 4_200 + Math.round(Math.random() * 3_000));
        };
        schedule();
        return () => clearTimeout(timer);
    }, [loaded, reducedMotion, rive]);

    return (
        <span
            className={`${className ?? ''} ${styles.riveStage}`}
            data-asset={assetId}
            data-facing={facing}
            data-flip={flipped ? 'true' : undefined}
        >
            {!loaded && <span className={styles.riveLoading} aria-hidden="true">🐾</span>}
            <RiveComponent className={styles.riveCanvas} aria-label={`${assetId} 互动宠物`} />
        </span>
    );
}
