import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

// 配置
const MAX_ATTEMPTS = 5;           // 最大尝试次数
const LOCKOUT_MINUTES = 15;       // 锁定时间（分钟）
const SESSION_HOURS = 24 * 7;     // Session 有效期（7天）

// 获取客户端 IP
function getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() :
        request.headers.get('x-real-ip') ||
        'unknown';
    return ip;
}

// 检查 IP 是否被锁定
async function isIPLocked(ip: string): Promise<boolean> {
    const lockoutTime = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);

    const recentFailures = await prisma.authAttempt.count({
        where: {
            ip,
            success: false,
            createdAt: { gte: lockoutTime }
        }
    });

    return recentFailures >= MAX_ATTEMPTS;
}

// 记录尝试
async function recordAttempt(ip: string, success: boolean) {
    await prisma.authAttempt.create({
        data: { ip, success }
    });
}

export async function POST(request: NextRequest) {
    try {
        const ip = getClientIP(request);

        // 检查是否被锁定
        if (await isIPLocked(ip)) {
            return NextResponse.json(
                { error: `尝试次数过多，请 ${LOCKOUT_MINUTES} 分钟后再试` },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { questionId, answer } = body;

        if (!questionId || !answer) {
            return NextResponse.json(
                { error: '请提供问题ID和答案' },
                { status: 400 }
            );
        }

        // 获取问题
        const question = await prisma.securityQuestion.findUnique({
            where: { id: questionId }
        });

        if (!question) {
            return NextResponse.json(
                { error: '问题不存在' },
                { status: 404 }
            );
        }

        // 验证答案（bcrypt 比对）
        const isValid = await bcrypt.compare(
            answer.trim().toLowerCase(),
            question.answer
        );

        // 记录尝试
        await recordAttempt(ip, isValid);

        if (!isValid) {
            // 计算剩余尝试次数
            const lockoutTime = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
            const recentFailures = await prisma.authAttempt.count({
                where: {
                    ip,
                    success: false,
                    createdAt: { gte: lockoutTime }
                }
            });
            const remaining = MAX_ATTEMPTS - recentFailures;

            return NextResponse.json(
                { error: `答案不正确，还剩 ${remaining} 次尝试机会` },
                { status: 401 }
            );
        }

        // 验证成功，设置 Cookie
        const cookieStore = await cookies();
        const sessionToken = btoa(JSON.stringify({
            authenticated: true,
            timestamp: Date.now(),
            ip
        }));

        cookieStore.set('auth_session', sessionToken, {
            httpOnly: true,
            secure: false, // 强制 false 以测试 localhost 兼容性
            sameSite: 'lax',
            maxAge: SESSION_HOURS * 60 * 60,
            path: '/'
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Verification failed:', error);
        return NextResponse.json(
            { error: '验证失败，请重试' },
            { status: 500 }
        );
    }
}
