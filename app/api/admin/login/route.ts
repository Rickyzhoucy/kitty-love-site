import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

const ADMIN_SESSION_HOURS = 24;

// 管理员登录
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return NextResponse.json(
                { error: '请输入用户名和密码' },
                { status: 400 }
            );
        }

        // 查找管理员
        const admin = await prisma.admin.findUnique({
            where: { username }
        });

        if (!admin) {
            return NextResponse.json(
                { error: '用户名或密码错误' },
                { status: 401 }
            );
        }

        // 检查审核状态
        if (admin.status === 'pending') {
            return NextResponse.json(
                { error: '账号正在审核中，请等待管理员审批' },
                { status: 403 }
            );
        }

        if (admin.status === 'rejected') {
            return NextResponse.json(
                { error: '账号审核未通过' },
                { status: 403 }
            );
        }

        // 验证密码
        const isValid = await bcrypt.compare(password, admin.password);

        if (!isValid) {
            return NextResponse.json(
                { error: '用户名或密码错误' },
                { status: 401 }
            );
        }

        // 设置管理员 Cookie
        const cookieStore = await cookies();
        const adminToken = btoa(JSON.stringify({
            adminId: admin.id,
            username: admin.username,
            timestamp: Date.now()
        }));

        cookieStore.set('admin_session', adminToken, {
            httpOnly: true,
            secure: false, // 强制 false 以测试 localhost 兼容性
            sameSite: 'lax',
            maxAge: ADMIN_SESSION_HOURS * 60 * 60,
            path: '/'
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Admin login failed:', error);
        return NextResponse.json(
            { error: '登录失败' },
            { status: 500 }
        );
    }
}

// 检查管理员状态
export async function GET() {
    try {
        const cookieStore = await cookies();
        const adminCookie = cookieStore.get('admin_session');

        if (!adminCookie?.value) {
            return NextResponse.json({ authenticated: false });
        }

        const sessionData = JSON.parse(
            Buffer.from(adminCookie.value, 'base64').toString()
        );

        const expiryTime = sessionData.timestamp + (ADMIN_SESSION_HOURS * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
            return NextResponse.json({ authenticated: false });
        }

        return NextResponse.json({
            authenticated: true,
            adminId: sessionData.adminId,
            username: sessionData.username
        });

    } catch {
        return NextResponse.json({ authenticated: false });
    }
}
