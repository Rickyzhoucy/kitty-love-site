import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addPetExperience } from '@/lib/petExperience';

// Force dynamic rendering for API routes
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const messages = await prisma.message.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(messages);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { nickname, content } = body;

        if (!nickname || !content) {
            return NextResponse.json({ error: 'Nickname and content are required' }, { status: 400 });
        }

        const newMessage = await prisma.message.create({
            data: {
                nickname,
                content,
            },
        });

        // 给宠物增加经验值 (+15)
        await addPetExperience(15, 'message');

        return NextResponse.json(newMessage, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        await prisma.message.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
    }
}
