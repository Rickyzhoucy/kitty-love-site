import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addPetExperience } from '@/lib/petExperience';

// Force dynamic rendering for API routes
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const memos = await prisma.memo.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(memos);
    } catch (error) {
        console.error('GET /api/memos error:', error);
        return NextResponse.json({ error: 'Failed to fetch memos', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { category, text } = body;

        if (!category || !text) {
            return NextResponse.json({ error: 'Category and text are required' }, { status: 400 });
        }

        const newMemo = await prisma.memo.create({
            data: {
                category,
                text,
                completed: false,
            },
        });

        // 给宠物增加经验值 (添加备忘录 +10)
        await addPetExperience(10, 'memo_add');

        return NextResponse.json(newMemo, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to save memo' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, completed } = body;

        if (!id || completed === undefined) {
            return NextResponse.json({ error: 'ID and status are required' }, { status: 400 });
        }

        const updatedMemo = await prisma.memo.update({
            where: { id },
            data: { completed },
        });

        // 完成备忘录给宠物增加经验值 (+20)
        if (completed) {
            await addPetExperience(20, 'memo_complete');
        }

        return NextResponse.json(updatedMemo);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update memo' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        await prisma.memo.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete memo' }, { status: 500 });
    }
}
