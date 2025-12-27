import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET: Fetch history for a specific key or all
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const key = searchParams.get('key');

        const where = key ? { key } : {};

        const history = await prisma.siteConfigHistory.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 50 // Limit to last 50 entries
        });

        return NextResponse.json(history);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}

// POST: Rollback to a specific history version
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id } = body; // history id

        if (!id) return NextResponse.json({ error: 'History ID required' }, { status: 400 });

        const historyEntry = await prisma.siteConfigHistory.findUnique({
            where: { id }
        });

        if (!historyEntry) {
            return NextResponse.json({ error: 'History entry not found' }, { status: 404 });
        }

        // Restore the value using a transaction
        await prisma.$transaction([
            prisma.siteConfig.upsert({
                where: { key: historyEntry.key },
                update: { value: historyEntry.value },
                create: { key: historyEntry.key, value: historyEntry.value }
            }),
            prisma.siteConfigHistory.create({
                data: {
                    key: historyEntry.key,
                    value: historyEntry.value
                }
            })
        ]);

        return NextResponse.json({ success: true, restoredValue: historyEntry.value });
    } catch (error) {
        console.error('Rollback failed', error);
        return NextResponse.json({ error: 'Rollback failed' }, { status: 500 });
    }
}
