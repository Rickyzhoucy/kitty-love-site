import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PAGES = new Set(['/verify', '/admin']);

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
