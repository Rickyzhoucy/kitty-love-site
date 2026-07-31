'use client';

import { useEffect, useRef, useState } from 'react';
import type { MapPin } from '@/lib/api/mapPins';
import {
    AMAP_KEY,
    loadAmap,
    loadPlugins,
    type AmapMap,
    type AmapMarker,
    type AmapNamespace,
} from './amapLoader';

/**
 * 高德地图画布（计划文档 §2.5）。
 *
 * 坐标是 GCJ-02，与库里存的一致，这里不做任何转换。
 */

/** 定位彻底失败时的落点。北京天安门——总得有个地方。 */
const FALLBACK_CENTER: [number, number] = [116.397428, 39.90923];
const CITY_ZOOM = 11;
const PRECISE_ZOOM = 15;

/**
 * 定位到「我在哪」，两级降级。
 *
 * 1. `AMap.Geolocation`——走浏览器的定位 API，**会弹权限请求**，精度到街区。
 * 2. `AMap.CitySearch`——按 IP 猜城市，不弹窗也不需要授权，精度只到市。
 *
 * 先精确后粗略：用户拒绝授权或超时的时候，退到城市级也比停在北京强。两级都
 * 失败就静默留在兜底点——为定位失败弹一个「定位失败」除了添堵没有别的作用，
 * 地图照样能用能打点。
 */
async function locate(
    AMap: AmapNamespace,
    map: AmapMap,
    stillWanted: () => boolean,
): Promise<void> {
    await loadPlugins(AMap, ['AMap.Geolocation', 'AMap.CitySearch']);
    if (!stillWanted()) return;

    const precise = await new Promise<[number, number] | null>(resolve => {
        if (!AMap.Geolocation) return resolve(null);
        try {
            new AMap.Geolocation({
                // 超时给足：第一次要等用户点授权弹窗。
                timeout: 10_000,
                enableHighAccuracy: true,
            }).getCurrentPosition((status, result) => {
                if (status !== 'complete' || typeof result === 'string' || !result.position) {
                    return resolve(null);
                }
                resolve([result.position.lng, result.position.lat]);
            });
        } catch {
            resolve(null);
        }
    });

    if (!stillWanted()) return;
    if (precise) {
        map.setCenter(precise);
        map.setZoom(PRECISE_ZOOM);
        return;
    }

    // 退到 IP 定位。注意它**不会**弹权限窗——那是浏览器定位 API 才有的，
    // 这一级纯粹按出口 IP 猜城市。
    await new Promise<void>(resolve => {
        if (!AMap.CitySearch) return resolve();
        try {
            new AMap.CitySearch().getLocalCity((status, result) => {
                if (
                    stillWanted()
                    && status === 'complete'
                    && typeof result !== 'string'
                ) {
                    const center = result.bounds?.getCenter();
                    if (center) {
                        map.setCenter([center.lng, center.lat]);
                        map.setZoom(CITY_ZOOM);
                    }
                }
                resolve();
            });
        } catch {
            resolve();
        }
    });
}

interface AmapCanvasProps {
    pins: MapPin[];
    /** 点地图空白处：用于新增点。给的是 GCJ-02 坐标。 */
    onPickLocation?: (coords: { lat: number; lng: number }) => void;
    onSelectPin?: (pin: MapPin) => void;
    /**
     * 让地图飞到某个坐标（搜索选中、点列表里的某一项）。
     * 带 nonce 是为了「再选一次同一个地方」也能重新居中。
     */
    focus?: { lng: number; lat: number; nonce: number } | null;
    className?: string;
}

export default function AmapCanvas({
    pins,
    onPickLocation,
    onSelectPin,
    focus,
    className,
}: AmapCanvasProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<AmapMap | null>(null);
    const markersRef = useRef<AmapMarker[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    // 回调放 ref 里：地图只初始化一次，不该因为父组件重渲染就重建
    const pickRef = useRef(onPickLocation);
    const selectRef = useRef(onSelectPin);
    useEffect(() => {
        pickRef.current = onPickLocation;
        selectRef.current = onSelectPin;
    }, [onPickLocation, onSelectPin]);

    useEffect(() => {
        // 没配 Key 是构建期就定了的静态事实，渲染时直接判断，不必过 state
        if (!AMAP_KEY) return;
        let cancelled = false;

        void loadAmap()
            .then(AMap => {
                if (cancelled || !containerRef.current) return;
                const map = new AMap.Map(containerRef.current, {
                    zoom: CITY_ZOOM,
                    center: FALLBACK_CENTER,
                    viewMode: '2D',
                });
                map.on('click', event => {
                    pickRef.current?.({ lat: event.lnglat.lat, lng: event.lnglat.lng });
                });
                mapRef.current = map;
                setReady(true);
                // 定位是异步的，回来时组件可能已经卸载了
                void locate(AMap, map, () => !cancelled);
            })
            .catch((reason: Error) => {
                if (!cancelled) setError(reason.message);
            });

        return () => {
            cancelled = true;
            mapRef.current?.destroy();
            mapRef.current = null;
            markersRef.current = [];
        };
    }, []);

    // 点变了就重画。几十个量级，全量重建比 diff 简单且够快。
    useEffect(() => {
        const map = mapRef.current;
        const AMap = window.AMap;
        if (!ready || !map || !AMap) return;

        markersRef.current.forEach(marker => map.remove(marker));
        markersRef.current = pins.map(pin => {
            const marker = new AMap.Marker({
                position: [pin.lng, pin.lat],
                title: pin.title,
            });
            marker.on('click', () => selectRef.current?.(pin));
            map.add(marker);
            return marker;
        });
    }, [pins, ready]);

    // 搜索选中 / 点了列表里的某一项。
    //
    // 刻意**不**在这里对全部点 setFitView：初始视野归定位管，「我在哪」比
    // 「我标过哪些地方」更适合当默认。想看某个点，点它就行。
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !focus) return;
        map.setCenter([focus.lng, focus.lat]);
        map.setZoom(PRECISE_ZOOM);
    }, [focus, ready]);

    // 所有 hook 都声明完了，这里的提前返回不影响 hook 顺序。
    const blocker = !AMAP_KEY ? '还没配地图 Key（NEXT_PUBLIC_AMAP_KEY）' : error;
    if (blocker) {
        return (
            <div
                className={className}
                role="status"
                style={{ display: 'grid', placeItems: 'center' }}
            >
                <p className="m-0 px-4 text-center text-sm text-ink-muted">{blocker}</p>
            </div>
        );
    }

    return <div ref={containerRef} className={className} aria-label="恋爱地图" />;
}
