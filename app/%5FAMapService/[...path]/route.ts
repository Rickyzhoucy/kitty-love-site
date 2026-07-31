import { NextRequest } from 'next/server';

/**
 * 高德「安全密钥」代理（恋爱地图，计划文档 §2.5）。
 *
 * 2021-12-02 之后新建的 JS API Key 必须配合安全密钥使用，官方给了两条路：
 *
 * 1. 明文塞前端：`window._AMapSecurityConfig = { securityJsCode: 'xxx' }`
 * 2. 代理服务器：前端只配 `serviceHost`，由服务端把 `jscode` 拼上去
 *
 * 这里走第二条。第一条等于把密钥公开——任何人打开开发者工具就能拿走刷配额，
 * 而配额是按账号计费的。Key 本身公开没关系（它必须在浏览器里，靠域名白名单
 * 保护），**安全密钥不一样，它是真的密钥**，只该留在服务端。
 *
 * ## 为什么目录叫 `%5FAMapService`
 *
 * 高德**强制**要求代理的一级路由就叫 `_AMapService`——名字不对时 SDK 直接弹
 * 窗「代理服务请以_AMapService 作为一级路由」并放弃安全模式，底图就一片空白。
 * 而 App Router 把下划线开头的目录当私有目录、整个排除出路由，`route.ts` 根本
 * 不会注册。`%5F` 是 Next 官方给的转义：目录名写 `%5FAMapService`，实际 URL
 * 就是 `/_AMapService`。两边的硬约束只有这么一个交集，别「顺手」改回下划线或
 * 换个好看的名字，两种改法都会让地图静默失效。
 *
 * 这条路由不在 `/api/` 下，但 proxy.ts 的 matcher 覆盖全站，所以没登录依然
 * 进不来（会被重定向到 /verify）——代理带着密钥，这个门是必要的。
 */

const UPSTREAM = 'https://restapi.amap.com';

/**
 * 只转发 JS API 实际会用到的那几类。白名单而不是全放行——代理带着密钥，等于
 * 一个「已签名的高德 REST 通道」，范围越小越好。
 *
 * `/v3/log` 是 SDK 自己的初始化埋点：拦掉它并不会让地图不可用，但控制台会留
 * 一条 403 失败请求，排查别的问题时是噪音，所以放进来。
 */
const ALLOWED_PREFIXES = [
    '/v3/log',
    // CitySearch 按 IP 定位当前城市，地图打开时用它决定初始视野
    '/v3/ip',
    '/v3/place',
    '/v5/place',
    '/v3/geocode',
    '/v3/assistant',
    '/v3/staticmap',
    '/v4/map',
    '/v4/grid',
];

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    const securityCode = process.env.AMAP_SECURITY_JS_CODE;
    if (!securityCode) {
        return Response.json(
            { info: '服务端没有配 AMAP_SECURITY_JS_CODE', infocode: '0' },
            { status: 500 },
        );
    }

    const { path } = await context.params;
    const upstreamPath = `/${(path ?? []).join('/')}`;
    if (!ALLOWED_PREFIXES.some(prefix => upstreamPath.startsWith(prefix))) {
        return Response.json(
            { info: '这个高德接口不在代理白名单里', infocode: '0' },
            { status: 403 },
        );
    }

    const target = new URL(UPSTREAM + upstreamPath);
    request.nextUrl.searchParams.forEach((value, key) => {
        // 前端不该自己传 jscode，传了也不算——由服务端统一拼。
        if (key !== 'jscode') target.searchParams.append(key, value);
    });
    target.searchParams.set('jscode', securityCode);

    try {
        const upstream = await fetch(target, {
            headers: { Accept: 'application/json' },
            // 地图搜索结果没有必要缓存在我们这一层，高德那边自己有缓存
            cache: 'no-store',
        });
        const body = await upstream.text();
        return new Response(body, {
            status: upstream.status,
            headers: {
                'Content-Type':
                    upstream.headers.get('Content-Type') ?? 'application/json',
            },
        });
    } catch {
        // 不把上游异常原样抛出去：里面可能带着拼好的 URL，那上面有 jscode。
        return Response.json(
            { info: '高德服务连不上', infocode: '0' },
            { status: 502 },
        );
    }
}
