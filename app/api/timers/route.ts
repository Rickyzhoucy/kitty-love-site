import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const timers = await prisma.eventTimer.findMany({
            orderBy: { date: 'asc' },
        });
        return NextResponse.json(timers);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch timers' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { title, date, type, description } = body;

        if (!title || !date || !type) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const newTimer = await prisma.eventTimer.create({
            data: {
                title,
                date,
                type,
                description,
            },
        });

        return NextResponse.json(newTimer, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create timer' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        await prisma.eventTimer.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete timer' }, { status: 500 });
    }
}
