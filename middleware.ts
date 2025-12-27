import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 完全公开的路径（不需要任何认证）
const FULLY_PUBLIC_PATHS = [
    '/verify',
    '/api/auth/question',
    '/api/auth/verify',
    '/api/auth/logout',
];

// 管理员公开路径（不需要任何认证，用于登录注册）
const ADMIN_PUBLIC_PATHS = [
    '/admin',
    '/api/admin/login',
    '/api/admin/register',
    '/api/admin/debug',
];

// 需要管理员认证的路径
const ADMIN_PROTECTED_PATHS = [
    '/admin/dashboard',
    '/admin/questions',
    '/admin/manage',
    '/api/admin/questions',
    '/api/admin/manage',
    '/api/admin/logout',
];

const SESSION_HOURS = 24 * 7;
const ADMIN_SESSION_HOURS = 24;

// 验证用户 Session（问答验证）
function verifyUserSession(request: NextRequest): { valid: boolean; expired: boolean } {
    const authCookie = request.cookies.get('auth_session');

    if (!authCookie?.value) {
        return { valid: false, expired: false };
    }

    try {
        // 使用 atob 兼容 Edge Runtime
        const decoded = atob(authCookie.value);
        const sessionData = JSON.parse(decoded);

        if (!sessionData.authenticated) {
            return { valid: false, expired: false };
        }

        const expiryTime = sessionData.timestamp + (SESSION_HOURS * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
            return { valid: false, expired: true };
        }

        return { valid: true, expired: false };
    } catch {
        return { valid: false, expired: false };
    }
}

// 验证管理员 Session
function verifyAdminSession(request: NextRequest): { valid: boolean; expired: boolean; reason?: string } {
    const adminCookie = request.cookies.get('admin_session');

    if (!adminCookie?.value) {
        return { valid: false, expired: false, reason: 'no_cookie' };
    }

    try {
        // 使用 atob 兼容 Edge Runtime
        const decoded = atob(adminCookie.value);
        const sessionData = JSON.parse(decoded);

        if (!sessionData.adminId) {
            return { valid: false, expired: false, reason: 'no_admin_id' };
        }

        const expiryTime = sessionData.timestamp + (ADMIN_SESSION_HOURS * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
            return { valid: false, expired: true, reason: 'expired' };
        }

        return { valid: true, expired: false };
    } catch (e: any) {
        return { valid: false, expired: false, reason: `error:${e.message}` };
    }
}

// 精确匹配或前缀匹配
function matchPath(pathname: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
        // 精确匹配 /admin，防止匹配到 /admin/dashboard
        if (pattern === '/admin') {
            return pathname === '/admin' || pathname === '/admin/';
        }
        return pathname.startsWith(pattern);
    });
}

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 静态资源跳过
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/static') ||
        pathname.startsWith('/uploads') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    // 1. 如果是公开路径（验证页面、问答API等），直接允许访问
    if (matchPath(pathname, FULLY_PUBLIC_PATHS)) {
        return NextResponse.next();
    }

    // 2. ADMIN 相关路径处理逻辑 - 与普通用户验证完全隔离
    // 检查是否是管理员相关路径（包括登录页、Dashboard、API等）
    const isAdminProtected = matchPath(pathname, ADMIN_PROTECTED_PATHS);
    const isAdminPublic = matchPath(pathname, ADMIN_PUBLIC_PATHS);

    if (isAdminProtected || isAdminPublic) {
        // 只有受保护的管理员路径才需要鉴权
        if (isAdminProtected) {
            const adminSession = verifyAdminSession(request);
            if (!adminSession.valid) {
                // API 返回 401
                if (pathname.startsWith('/api/')) {
                    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
                }
                // 页面重定向到管理员登录
                const adminLoginUrl = new URL('/admin', request.url);
                if (adminSession.reason) {
                    adminLoginUrl.searchParams.set('debug_error', adminSession.reason);
                }
                const response = NextResponse.redirect(adminLoginUrl);
                if (adminSession.expired) {
                    response.cookies.delete('admin_session');
                }
                return response;
            }
        }
        // 是管理员公开路径 OR 管理员保护路径鉴权通过，直接放行
        return NextResponse.next();
    }

    // 3. 普通用户路径 - 这里只处理非管理员且非公开的路径
    // 如果没有通过上面所有的检查，说明这是普通页面，需要进行问答验证
    const userSession = verifyUserSession(request);
    if (!userSession.valid) {
        const verifyUrl = new URL('/verify', request.url);
        verifyUrl.searchParams.set('redirect', pathname);
        const response = NextResponse.redirect(verifyUrl);
        if (userSession.expired) {
            response.cookies.delete('auth_session');
        }
        return response;
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
