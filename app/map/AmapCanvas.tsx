'use client';

import { useEffect, useRef, useState } from 'react';
import type { MapPin } from '@/lib/api/mapPins';

/**
 * 高德地图画布（计划文档 §2.5）。
 *
 * **安全密钥走代理，不放前端**：`serviceHost` 指到我们自己的 `/_AMapService`，
 * 由那个路由在服务端拼上 `jscode`。明文写在这里的话，任何人打开开发者工具
 * 就能拿走刷配额（Key 本身公开没关系，它必须在浏览器里，靠域名白名单保护；
 * 安全密钥不一样）。
 *
 * 这个路径是高德硬性要求的一级路由名，不能改——原因见
 * app/%5FAMapService/[...path]/route.ts 的注释。
 *
 * 坐标是 GCJ-02，与库里存的一致，这里不做任何转换。
 */

/** 高德的类型没有 @types 包，用到的那几个成员就地声明，不引 any 满天飞。 */
interface AmapMarker {
    setPosition(position: [number, number]): void;
    on(event: string, handler: () => void): void;
}
interface AmapMap {
    add(overlay: AmapMarker): void;
    remove(overlay: AmapMarker): void;
    setFitView(overlays?: AmapMarker[] | null): void;
    on(event: string, handler: (event: { lnglat: { lng: number; lat: number } }) => void): void;
    destroy(): void;
}
interface AmapNamespace {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => AmapMap;
    Marker: new (options: Record<string, unknown>) => AmapMarker;
}
declare global {
    interface Window {
        AMap?: AmapNamespace;
        _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string };
    }
}

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY ?? '';
const SCRIPT_ID = 'amap-jsapi';

/**
 * 要不要启用「安全密钥代理」模式。
 *
 * **底图和 Marker 不需要它**——安全密钥只在调用 Web 服务（POI 搜索、地理编码）
 * 时才必须。而一旦开了这个模式，SDK 会把校验也一起打开：serviceHost 稍有不合
 * 它的预期就整个罢工（底图空白、地图不响应点击），而报错只有一个语焉不详的
 * 弹窗。当前这一页只用底图 + 打点，所以默认关着。
 *
 * 等真要加地址搜索时把它打开——代理路由（app/%5FAMapService）已经写好并验证过
 * 能正确转发签名请求，那时只需要把这里改成 true。
 */
const USE_SECURITY_PROXY = false;

/** 只加载一次。多个组件实例共用同一个 script 标签和同一个 Promise。 */
let loaderPromise: Promise<AmapNamespace> | null = null;

function loadAmap(): Promise<AmapNamespace> {
    if (window.AMap) return Promise.resolve(window.AMap);
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise<AmapNamespace>((resolve, reject) => {
        // 必须在加载 JS API **之前**设好，否则这一轮的服务调用不走代理
        if (USE_SECURITY_PROXY) {
            window._AMapSecurityConfig = {
                serviceHost: `${window.location.origin}/_AMapService`,
            };
        }

        const settle = () => {
            if (window.AMap) {
                resolve(window.AMap);
            } else {
                reject(new Error('AMap 没挂上'));
            }
        };

        const existing = document.getElementById(SCRIPT_ID);
        if (existing) {
            existing.addEventListener('load', settle);
            existing.addEventListener('error', () => reject(new Error('高德脚本加载失败')));
            return;
        }

        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}`;
        script.onload = settle;
        script.onerror = () => reject(new Error('高德脚本加载失败'));
        document.head.appendChild(script);
    });
    return loaderPromise;
}

interface AmapCanvasProps {
    pins: MapPin[];
    /** 点地图空白处：用于新增点。给的是 GCJ-02 坐标。 */
    onPickLocation?: (coords: { lat: number; lng: number }) => void;
    onSelectPin?: (pin: MapPin) => void;
    className?: string;
}

export default function AmapCanvas({
    pins,
    onPickLocation,
    onSelectPin,
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
        // 没配 Key 是个构建期就定了的静态事实，不需要过 state——渲染时直接判断，
        // 免得为一个永远不变的条件触发一次多余的渲染。
        if (!AMAP_KEY) return;
        let cancelled = false;
        void loadAmap()
            .then(AMap => {
                if (cancelled || !containerRef.current) return;
                const map = new AMap.Map(containerRef.current, {
                    zoom: 11,
                    // 北京天安门。真正的视野在有点之后由 setFitView 决定。
                    center: [116.397428, 39.90923],
                    viewMode: '2D',
                });
                map.on('click', event => {
                    pickRef.current?.({ lat: event.lnglat.lat, lng: event.lnglat.lng });
                });
                mapRef.current = map;
                setReady(true);
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

    // 点变了就重画。数量是几十个量级，全量重建比 diff 简单且够快。
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
        if (markersRef.current.length) map.setFitView(markersRef.current);
    }, [pins, ready]);

    // 所有 hook 都在上面声明完了，这里的提前返回不影响 hook 顺序。
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
