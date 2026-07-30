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

    if (asset?.renderer === 'rive') {
        return (
            <span className={`${props.className ?? ''} ${styles.petVisual}`} data-facing={props.facing}>
                <RivePetRenderer
                    key={asset.source}
                    assetId={asset.id}
                    source={asset.source}
                    artboard={asset.artboard}
                    activity={props.activity}
                    facing={props.facing}
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
        <span className={`${props.className ?? ''} ${styles.petVisual}`} data-facing={props.facing}>
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
