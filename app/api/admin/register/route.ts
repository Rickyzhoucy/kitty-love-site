import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// 管理员注册
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

        if (username.length < 3 || password.length < 6) {
            return NextResponse.json(
                { error: '用户名至少3位，密码至少6位' },
                { status: 400 }
            );
        }

        // 检查用户名是否已存在
        const existing = await prisma.admin.findUnique({
            where: { username }
        });

        if (existing) {
            return NextResponse.json(
                { error: '该用户名已被使用' },
                { status: 409 }
            );
        }

        // 检查是否是第一个管理员
        const adminCount = await prisma.admin.count();
        const isFirstAdmin = adminCount === 0;

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 创建管理员
        const newAdmin = await prisma.admin.create({
            data: {
                username,
                password: hashedPassword,
                status: isFirstAdmin ? 'approved' : 'pending'
            },
            select: {
                id: true,
                username: true,
                status: true,
                createdAt: true
            }
        });

        return NextResponse.json({
            success: true,
            message: isFirstAdmin
                ? '注册成功！您是第一位管理员，已自动通过审核。'
                : '注册成功！请等待管理员审核。',
            admin: newAdmin
        }, { status: 201 });

    } catch (error) {
        console.error('Registration failed:', error);
        return NextResponse.json(
            { error: '注册失败，请重试' },
            { status: 500 }
        );
    }
}
