import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Force dynamic rendering for API routes
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const photos = await prisma.photo.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(photos);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch photos' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { url, caption, date } = body;

        // We allow basic placeholders if url is empty, but ideally required
        if (!caption) {
            return NextResponse.json({ error: 'Caption is required' }, { status: 400 });
        }

        const newPhoto = await prisma.photo.create({
            data: {
                url: url || '', // Empty URL will use CSS color placeholder in frontend logic
                caption,
                date,
            },
        });

        return NextResponse.json(newPhoto, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to add photo' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        await prisma.photo.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 });
    }
}
