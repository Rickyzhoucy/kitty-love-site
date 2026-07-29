'use client';

import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export type PetFrameAction = 'idle' | 'walk' | 'crawl';

interface ManifestAction {
    fps: number;
    loop: boolean;
    frames: string[];
}

interface PetAssetManifest {
    schemaVersion: number;
    petId: string;
    version: string;
    canvas: {
        width: number;
        height: number;
        anchorX: number;
        anchorY: number;
    };
    defaultAction: PetFrameAction;
    actions: Partial<Record<PetFrameAction, ManifestAction>>;
}

interface ManifestFrameRendererProps {
    assetId: string;
    action?: PetFrameAction;
    fallbackEmoji?: string;
    className?: string;
    onError?: (error: Error) => void;
}

const manifestCache = new Map<string, Promise<PetAssetManifest>>();
const assetBaseUrl = (process.env.NEXT_PUBLIC_PET_ASSET_BASE_URL || '/pet-content').replace(/\/+$/, '');

function assetRoot(assetId: string): string {
    return `${assetBaseUrl}/${encodeURIComponent(assetId)}/v1`;
}

function manifestUrl(assetId: string): string {
    return `${assetRoot(assetId)}/manifest.json`;
}

function loadManifest(assetId: string): Promise<PetAssetManifest> {
    const cached = manifestCache.get(assetId);
    if (cached) return cached;

    const pending = fetch(manifestUrl(assetId), { credentials: 'same-origin' })
        .then(async response => {
            if (!response.ok) throw new Error(`宠物资源清单加载失败（${response.status}）`);
            const manifest = await response.json() as PetAssetManifest;
            if (!manifest.actions?.idle?.frames?.length) {
                throw new Error('宠物资源缺少 idle 动画');
            }
            return manifest;
        })
        .catch(error => {
            manifestCache.delete(assetId);
            throw error;
        });
    manifestCache.set(assetId, pending);
    return pending;
}

function preloadFrames(urls: string[]): Promise<void> {
    return Promise.all(urls.map(url => new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`宠物动画帧加载失败：${url}`));
        image.src = url;
    }))).then(() => undefined);
}

/**
 * 基于版本化 manifest 播放 WebP 帧动画。
 * 缺少 walk/crawl 时自动回落 idle；系统减少动态效果时固定展示首帧。
 */
export default function ManifestFrameRenderer({
    assetId,
    action = 'idle',
    fallbackEmoji = '🐾',
    className,
    onError,
}: ManifestFrameRendererProps) {
    const reduceMotion = useReducedMotion();
    const [loadState, setLoadState] = useState<{
        assetId: string;
        manifest: PetAssetManifest | null;
        failed: boolean;
    }>({ assetId, manifest: null, failed: false });
    const [frameState, setFrameState] = useState({ key: '', index: 0 });

    useEffect(() => {
        let active = true;

        loadManifest(assetId)
            .then(async loaded => {
                const urls = Object.values(loaded.actions)
                    .flatMap(item => item?.frames ?? [])
                    .map(frame => `${assetRoot(assetId)}/${frame}`);
                await preloadFrames([...new Set(urls)]);
                if (active) setLoadState({ assetId, manifest: loaded, failed: false });
            })
            .catch(reason => {
                if (!active) return;
                const error = reason instanceof Error ? reason : new Error('宠物资源加载失败');
                setLoadState({ assetId, manifest: null, failed: true });
                onError?.(error);
            });

        return () => {
            active = false;
        };
    }, [assetId, onError]);

    const manifest = loadState.assetId === assetId ? loadState.manifest : null;
    const failed = loadState.assetId === assetId && loadState.failed;
    const selected = useMemo(() => {
        if (!manifest) return null;
        return manifest.actions[action]
            ?? manifest.actions[manifest.defaultAction]
            ?? manifest.actions.idle
            ?? null;
    }, [action, manifest]);

    useEffect(() => {
        if (!selected || reduceMotion || selected.frames.length < 2) return;

        const key = `${assetId}:${action}:${selected.frames.join('|')}`;
        const interval = window.setInterval(() => {
            setFrameState(current => {
                const currentIndex = current.key === key ? current.index : 0;
                const next = currentIndex + 1;
                if (next < selected.frames.length) return { key, index: next };
                return {
                    key,
                    index: selected.loop ? 0 : selected.frames.length - 1,
                };
            });
        }, Math.max(50, 1000 / Math.max(1, selected.fps)));
        return () => window.clearInterval(interval);
    }, [action, assetId, reduceMotion, selected]);

    if (failed) {
        return (
            <span className="flex h-full w-full items-center justify-center text-[80px] leading-none" role="img" aria-label="宠物">
                {fallbackEmoji}
            </span>
        );
    }

    if (!manifest || !selected) {
        return (
            <span className="flex h-full w-full items-center justify-center text-4xl animate-pulse" aria-label="正在加载宠物">
                🐾
            </span>
        );
    }

    const frameKey = `${assetId}:${action}:${selected.frames.join('|')}`;
    const currentIndex = frameState.key === frameKey ? frameState.index : 0;
    const safeIndex = Math.min(currentIndex, selected.frames.length - 1);
    return (
        <span
            className={className ?? 'block h-[170px] w-[170px] [filter:drop-shadow(0_4px_8px_rgba(0,0,0,0.12))]'}
        >
            {selected.frames.map((frame, index) => (
                // 每帧保持在 DOM 中，避免低速对象存储下切帧快于图片下载而持续空白。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={frame}
                    src={`${assetRoot(assetId)}/${frame}`}
                    alt={index === safeIndex ? `${manifest.petId} ${action} 动画` : ''}
                    aria-hidden={index !== safeIndex}
                    draggable={false}
                    className={index === safeIndex
                        ? 'block h-full w-full object-contain'
                        : 'hidden h-full w-full object-contain'}
                />
            ))}
        </span>
    );
}
