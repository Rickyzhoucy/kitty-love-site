import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addPetExperience } from '@/lib/petExperience';

// Force dynamic rendering for API routes
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const milestones = await prisma.milestone.findMany({
            orderBy: { date: 'asc' }, // Sort by date for timeline
        });
        return NextResponse.json(milestones);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { title, date, description } = body;

        if (!title || !date) {
            return NextResponse.json({ error: 'Title and Date are required' }, { status: 400 });
        }

        const newMilestone = await prisma.milestone.create({
            data: {
                title,
                date,
                description: description || '',
            },
        });

        // 给宠物增加经验值 (记录故事 +30)
        await addPetExperience(30, 'milestone');

        return NextResponse.json(newMilestone, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to add milestone' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        await prisma.milestone.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete milestone' }, { status: 500 });
    }
}
