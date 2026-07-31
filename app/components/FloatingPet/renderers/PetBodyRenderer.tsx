'use client';

import { useReducedMotion } from 'framer-motion';
import styles from '../FloatingPet.module.css';
import { getPetAsset } from '../petConfig';
import type { PetBodyState } from '../petBodyProtocol';
import ManifestFrameRenderer, { type PetFrameAction } from './ManifestFrameRenderer';
import RivePetRenderer from './RivePetRenderer';

interface PetBodyRendererProps extends PetBodyState {
    assetId: string;
    fallbackEmoji?: string;
    className?: string;
    onError?: (error: Error) => void;
}

function fallbackAction(state: PetBodyState): PetFrameAction {
    if (state.activity === 'walking') return 'walk';
    if (state.reaction?.name === 'play') return 'crawl';
    return 'idle';
}

export default function PetBodyRenderer(props: PetBodyRendererProps) {
    const reduceMotion = useReducedMotion();
    const asset = getPetAsset(props.assetId);

    // 只有「想朝的方向」和「素材本身的方向」不一致时才镜像。
    //
    // 以前这里是写死的「facing === 'right' 就翻」，等于假设所有素材都朝左——
    // 对 Rive 那两只狗成立，对四个帧序列正好相反，表现就是往左走却面朝右。
    // 朝向是素材的属性，不是全局约定，所以判断要落到 sourceFacing 上。
    const sourceFacing = asset?.sourceFacing ?? 'left';
    const flipped = props.facing !== sourceFacing;

    if (asset?.renderer === 'rive') {
        return (
            <span
                className={`${props.className ?? ''} ${styles.petVisual}`}
                data-facing={props.facing}
                data-flip={flipped ? 'true' : undefined}
            >
                <RivePetRenderer
                    key={asset.source}
                    assetId={asset.id}
                    source={asset.source}
                    artboard={asset.artboard}
                    activity={props.activity}
                    facing={props.facing}
                    flipped={flipped}
                    gaze={props.gaze}
                    reaction={props.reaction}
                    className={styles.bodyCanvas}
                    reducedMotion={Boolean(reduceMotion)}
                    onError={props.onError}
                />
            </span>
        );
    }

    return (
        <span
            className={`${props.className ?? ''} ${styles.petVisual}`}
            data-facing={props.facing}
            data-flip={flipped ? 'true' : undefined}
        >
            <ManifestFrameRenderer
                assetId={props.assetId}
                action={fallbackAction(props)}
                fallbackEmoji={props.fallbackEmoji}
                className={styles.bodyCanvas}
                onError={props.onError}
            />
        </span>
    );
}
