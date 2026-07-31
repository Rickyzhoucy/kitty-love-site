'use client';

/**
 * 高德 JS API 的加载与类型（恋爱地图，计划文档 §2.5）。
 *
 * 单独一个模块，因为地图画布和搜索框都要用：SDK 是全局单例，谁先用谁触发加载，
 * 后来者复用同一个 Promise。
 *
 * ## 安全密钥走代理，不放前端
 *
 * `serviceHost` 指到我们自己的 `/_AMapService`，由那个路由在服务端拼上
 * `jscode`。明文写在前端的话，任何人打开开发者工具就能拿走刷配额。Key 本身
 * 公开没关系（它必须在浏览器里，靠域名白名单保护），**安全密钥不一样**。
 *
 * 路径名和目录名的两处硬约束见 app/%5FAMapService/[...path]/route.ts。
 *
 * ## 一个容易被误判的地方
 *
 * 用 curl 直接打 `restapi.amap.com`（哪怕经过代理、jscode 拼对了）会返回
 * `USERKEY_PLAT_NOMATCH`——那是**正常的**，不代表配置坏了。Web端(JS API) 的
 * Key 只认 SDK 发出的请求（SDK 会带上 platform / sdkversion / csid 等一串参数）。
 * 想验证服务能不能用，只能在浏览器里调 SDK，不能用 curl。
 */

/** 高德没有官方 @types，用到的成员就地声明，避免 any 满天飞。 */
export interface AmapLngLat {
    lng: number;
    lat: number;
}

/** 能加到地图上的东西的公共部分。Marker 和 CircleMarker 都算。 */
export interface AmapOverlay {
    setMap?(map: AmapMap | null): void;
}

/**
 * 高德没有官方 @types，成员是就地声明的——**只声明亲手验证过存在的**。
 *
 * 这里曾经加过 `setAnimation` / `setzIndex`，照着文档写的，结果运行时是
 * `e.setAnimation is not a function`，整个页面白屏。手写的类型声明没有任何
 * 编译期保护：TS 说有，不代表 SDK 真的有。要用新方法，先在浏览器里调一次。
 */
export interface AmapMarker extends AmapOverlay {
    setPosition(position: [number, number]): void;
    on(event: string, handler: () => void): void;
}

/** 矢量圆点，半径按像素算（不随缩放变大）。用来画「我在这儿」。 */
export interface AmapCircleMarker extends AmapOverlay {
    setCenter(center: [number, number]): void;
}

export interface AmapMap {
    add(overlay: AmapOverlay): void;
    remove(overlay: AmapOverlay): void;
    setFitView(overlays?: AmapOverlay[] | null): void;
    setCenter(position: [number, number]): void;
    setZoom(zoom: number): void;
    on(event: string, handler: (event: { lnglat: AmapLngLat }) => void): void;
    destroy(): void;
}

export interface AmapCitySearchResult {
    /** 定位不到时 SDK 确实会不带这个字段，所以是可选的。 */
    bounds?: { getCenter(): AmapLngLat };
    city?: string;
}

export interface AmapGeolocationResult {
    position?: AmapLngLat;
    formattedAddress?: string;
    /** 定位精度，米。用来画那圈范围光晕。 */
    accuracy?: number;
}

export interface AmapPoi {
    id?: string;
    name?: string;
    address?: string | string[];
    district?: string;
    location?: AmapLngLat;
}

export interface AmapAutoCompleteResult {
    tips?: AmapPoi[];
}

export interface AmapNamespace {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => AmapMap;
    Marker: new (options: Record<string, unknown>) => AmapMarker;
    /** 2.0 的核心矢量图层，不需要 plugin() 加载。 */
    CircleMarker: new (options: Record<string, unknown>) => AmapCircleMarker;
    plugin(names: string[], onReady: () => void): void;
    CitySearch?: new () => {
        getLocalCity(
            callback: (status: string, result: AmapCitySearchResult | string) => void,
        ): void;
    };
    Geolocation?: new (options: Record<string, unknown>) => {
        getCurrentPosition(
            callback: (status: string, result: AmapGeolocationResult | string) => void,
        ): void;
    };
    AutoComplete?: new (options: Record<string, unknown>) => {
        search(
            keyword: string,
            callback: (status: string, result: AmapAutoCompleteResult | string) => void,
        ): void;
    };
}

declare global {
    interface Window {
        AMap?: AmapNamespace;
        _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string };
    }
}

export const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY ?? '';

const SCRIPT_ID = 'amap-jsapi';

/** 只加载一次。多个组件共用同一个 script 标签和同一个 Promise。 */
let loaderPromise: Promise<AmapNamespace> | null = null;

export function loadAmap(): Promise<AmapNamespace> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('高德 JS API 只能在浏览器里加载'));
    }
    if (!AMAP_KEY) {
        return Promise.reject(new Error('还没配地图 Key（NEXT_PUBLIC_AMAP_KEY）'));
    }
    if (window.AMap) return Promise.resolve(window.AMap);
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise<AmapNamespace>((resolve, reject) => {
        // 必须在加载 JS API **之前**设好，否则这一轮的服务调用不走代理
        window._AMapSecurityConfig = {
            serviceHost: `${window.location.origin}/_AMapService`,
        };

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

/** 加载插件。SDK 的 plugin 是回调式的，这里包成 Promise 好串起来。 */
export function loadPlugins(AMap: AmapNamespace, names: string[]): Promise<void> {
    return new Promise(resolve => AMap.plugin(names, resolve));
}
