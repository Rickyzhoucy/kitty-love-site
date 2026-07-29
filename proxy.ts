import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PAGES = new Set(['/verify', '/admin']);

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

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
