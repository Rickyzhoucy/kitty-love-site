import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
    try {
        // 随机获取一个安全问题
        const count = await prisma.securityQuestion.count();

        if (count === 0) {
            return NextResponse.json(
                { error: '还没有设置安全问题，请先在管理后台添加' },
                { status: 404 }
            );
        }

        const skip = Math.floor(Math.random() * count);
        const question = await prisma.securityQuestion.findFirst({
            skip,
            select: {
                id: true,
                question: true,
                hint: true
                // 注意：不返回答案！
            }
        });

        return NextResponse.json(question);
    } catch (error) {
        console.error('Failed to get question:', error);
        return NextResponse.json(
            { error: '获取问题失败' },
            { status: 500 }
        );
    }
}
