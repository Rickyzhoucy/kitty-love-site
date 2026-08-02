import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * 不需要登录就能打开的页面。
 *
 * `/desktop-pet` 在这里**不是**因为它该公开，而是因为**它绝不能被重定向**。
 *
 * 它是桌面版那个 220px、无边框、置顶的宠物窗口加载的路由。没放行之前，未登录
 * 时中间件把它重定向到 `/verify`——于是登录页被塞进一个两百像素的方框里飘在
 * 所有窗口最上面：输入框在可视区域外根本填不了，窗口又没有标题栏可以关。
 * 既登不进去，也关不掉。
 *
 * 放行它是安全的：这个页面自己不渲染任何数据，宠物要的东西全走 `/api/v1/*`，
 * 那边照样验会话。未登录时它只是一个空页面（而且会主动把窗口藏起来，
 * 见 DesktopPetBridge）。
 */
const PUBLIC_PAGES = new Set(['/verify', '/admin', '/desktop-pet']);

/**
 * 后台的门。**与主站是两把锁。**
 *
 * 改这一版之前，`/admin/*` 查的是主站的 `kitty_session`——任何能登进主站看
 * 照片的人，也能改模型配置、翻全部记忆、看会话列表。现在它查 `kitty_admin`，
 * 由 `AdminSession` 签发，主站会话在这里一文不值（后端的每个后台接口也各自
 * 再验一次，这里只是省掉一次白跑的往返）。
 */
const ADMIN_COOKIE = 'kitty_admin';

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 后台自己一套。放在最前面，免得下面主站的判断把它放行。
    if (pathname.startsWith('/admin')) {
        const isLoginPage = (pathname.replace(/\/$/, '') || '/') === '/admin';
        if (isLoginPage || request.cookies.get(ADMIN_COOKIE)?.value) {
            return NextResponse.next();
        }
        return NextResponse.redirect(new URL('/admin', request.url));
    }

    // Python API 自己校验高熵 Session；代理链不能在进入 FastAPI 前拦截登录请求。
    if (
        pathname.startsWith('/api/v1')
        || pathname.startsWith('/_next')
        || pathname.startsWith('/pet-content')
        || pathname.startsWith('/uploads')
        || PUBLIC_PAGES.has(pathname.replace(/\/$/, '') || '/')
    ) {
        return NextResponse.next();
    }

    // HttpOnly Cookie 的有效期和撤销状态由 `/api/v1/auth/me` 及各领域接口验证。
    // Middleware 只做页面入口的快速拦截，不解析或伪造 Session 内容。
    if (request.cookies.get('kitty_session')?.value) {
        return NextResponse.next();
    }

    if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: '需要登录' }, { status: 401 });
    }

    const loginUrl = new URL('/verify', request.url);
    loginUrl.searchParams.set('redirect', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
