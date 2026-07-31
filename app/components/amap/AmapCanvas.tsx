'use client';

import { useEffect, useRef, useState } from 'react';
import {
    AMAP_KEY,
    loadAmap,
    loadPlugins,
    type AmapMap,
    type AmapMarker,
    type AmapNamespace,
    type AmapOverlay,
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

/** 「我在这儿」的黄点。默认 Marker 是蓝水滴，和已标的地方撞色，所以自己画。 */
const HERE_FILL = '#f5a524';
const HERE_STROKE = '#ffffff';

/**
 * 画一个「我在这儿」的黄点。
 *
 * 用 `CircleMarker`（半径按**像素**算）而不是 `Circle`（按米算）：这个点表达的是
 * 「你在这儿」，缩放时该保持一样大；按米画的话缩到省级就变成一个盖住半个城市的
 * 色块了。真实精度另有一圈半透明光晕表示，那个才该按米走。
 */
function drawHereDot(
    AMap: AmapNamespace,
    map: AmapMap,
    position: [number, number],
): AmapOverlay[] {
    const halo = new AMap.CircleMarker({
        center: position,
        radius: 13,
        fillColor: HERE_FILL,
        fillOpacity: 0.22,
        strokeOpacity: 0,
        bubble: true,
        zIndex: 90,
    });
    const dot = new AMap.CircleMarker({
        center: position,
        radius: 6,
        fillColor: HERE_FILL,
        fillOpacity: 1,
        strokeColor: HERE_STROKE,
        strokeWeight: 2.5,
        strokeOpacity: 1,
        // 点击穿透到地图，否则在自己头上加不了点
        bubble: true,
        zIndex: 91,
    });
    map.add(halo);
    map.add(dot);
    return [halo, dot];
}

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
    onLocated: (overlays: AmapOverlay[]) => void,
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
        // 只有精确定位才画那个黄点。IP 定位给的是市中心，把它标成「你在这儿」
        // 是在撒谎——你可能在城市另一头。宁可不画。
        onLocated(drawHereDot(AMap, map, precise));
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

/** 地图只需要这几样。用最小形状而不是绑定某个具体资源，故事条目、地点、
 *  以后任何「有坐标的东西」都能直接画上去。 */
export interface MapMarkerItem {
    id: string;
    title: string;
    lat: number;
    lng: number;
}

interface AmapCanvasProps {
    pins: MapMarkerItem[];
    /** 点地图空白处：用于新增点。给的是 GCJ-02 坐标。 */
    onPickLocation?: (coords: { lat: number; lng: number }) => void;
    onSelectPin?: (pin: MapMarkerItem) => void;
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
    /** 「我在这儿」的黄点。与 markersRef 分开，免得重画点位时被一起清掉。 */
    const hereRef = useRef<AmapOverlay[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [located, setLocated] = useState(false);

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
                void locate(AMap, map, () => !cancelled, overlays => {
                    // 单独存一份：下面重画点位时会清空 markersRef，混在一起
                    // 的话「我在这儿」会跟着被抹掉。
                    hereRef.current = overlays;
                    setLocated(true);
                });
            })
            .catch((reason: Error) => {
                if (!cancelled) setError(reason.message);
            });

        return () => {
            cancelled = true;
            mapRef.current?.destroy();
            mapRef.current = null;
            markersRef.current = [];
            hereRef.current = [];
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

    return (
        <div className="relative">
            <div ref={containerRef} className={className} aria-label="恋爱地图" />
            {/* 图例只在真的画了黄点时才出现——没定位到就没有黄点，摆个说明反而
                让人去找一个不存在的东西。 */}
            {located && (
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-surface/85 px-2.5 py-1.5 text-[11px] text-ink-muted shadow-soft backdrop-blur-sm">
                    <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full border-2 border-white"
                        style={{ backgroundColor: HERE_FILL }}
                    />
                    你现在在这儿
                </div>
            )}
        </div>
    );
}
