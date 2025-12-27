import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// 获取所有管理员列表（不含密码）
export async function GET() {
    try {
        const admins = await prisma.admin.findMany({
            select: {
                id: true,
                username: true,
                status: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(admins);
    } catch (error) {
        console.error('Failed to fetch admins:', error);
        return NextResponse.json(
            { error: '获取管理员列表失败' },
            { status: 500 }
        );
    }
}

// 审核/更新管理员
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, action, newPassword } = body;

        if (!id) {
            return NextResponse.json(
                { error: '请提供管理员ID' },
                { status: 400 }
            );
        }

        // 审核操作
        if (action === 'approve' || action === 'reject') {
            const updated = await prisma.admin.update({
                where: { id },
                data: { status: action === 'approve' ? 'approved' : 'rejected' },
                select: { id: true, username: true, status: true }
            });
            return NextResponse.json(updated);
        }

        // 修改密码操作
        if (action === 'updatePassword' && newPassword) {
            if (newPassword.length < 6) {
                return NextResponse.json(
                    { error: '密码至少6位' },
                    { status: 400 }
                );
            }

            const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            await prisma.admin.update({
                where: { id },
                data: { password: hashedPassword }
            });
            return NextResponse.json({ success: true, message: '密码已更新' });
        }

        return NextResponse.json(
            { error: '无效的操作' },
            { status: 400 }
        );

    } catch (error) {
        console.error('Failed to update admin:', error);
        return NextResponse.json(
            { error: '操作失败' },
            { status: 500 }
        );
    }
}

// 删除管理员
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: '请提供管理员ID' },
                { status: 400 }
            );
        }

        // 检查是否是最后一个已审核的管理员
        const approvedCount = await prisma.admin.count({
            where: { status: 'approved' }
        });

        const targetAdmin = await prisma.admin.findUnique({
            where: { id },
            select: { status: true }
        });

        if (targetAdmin?.status === 'approved' && approvedCount <= 1) {
            return NextResponse.json(
                { error: '无法删除，必须保留至少一个管理员' },
                { status: 400 }
            );
        }

        await prisma.admin.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete admin:', error);
        return NextResponse.json(
            { error: '删除失败' },
            { status: 500 }
        );
    }
}
