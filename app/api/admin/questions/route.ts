import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// 获取所有问题（不返回答案）
export async function GET() {
    try {
        const questions = await prisma.securityQuestion.findMany({
            select: {
                id: true,
                question: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(questions);
    } catch (error) {
        console.error('Failed to fetch questions:', error);
        return NextResponse.json(
            { error: '获取问题列表失败' },
            { status: 500 }
        );
    }
}

// 添加新问题
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { question, answer } = body;

        if (!question || !answer) {
            return NextResponse.json(
                { error: '请提供问题和答案' },
                { status: 400 }
            );
        }

        // 加密答案（转小写后加密，验证时也转小写）
        const hashedAnswer = await bcrypt.hash(
            answer.trim().toLowerCase(),
            SALT_ROUNDS
        );

        const newQuestion = await prisma.securityQuestion.create({
            data: {
                question: question.trim(),
                answer: hashedAnswer
            },
            select: {
                id: true,
                question: true,
                createdAt: true
            }
        });

        return NextResponse.json(newQuestion, { status: 201 });
    } catch (error) {
        console.error('Failed to create question:', error);
        return NextResponse.json(
            { error: '添加问题失败' },
            { status: 500 }
        );
    }
}

// 删除问题
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: '请提供问题ID' },
                { status: 400 }
            );
        }

        await prisma.securityQuestion.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete question:', error);
        return NextResponse.json(
            { error: '删除问题失败' },
            { status: 500 }
        );
    }
}
