import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addPetExperience } from '@/lib/petExperience';

export const dynamic = 'force-dynamic';

// GET: 获取所有提醒
export async function GET() {
    try {
        const reminders = await prisma.reminder.findMany({
            orderBy: { dueDate: 'asc' },
        });
        return NextResponse.json(reminders);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
    }
}

// POST: 创建提醒
export async function POST(request: Request) {
    try {
        const { content, dueDate } = await request.json();

        if (!content || !dueDate) {
            return NextResponse.json({ error: 'Content and Due Date are required' }, { status: 400 });
        }

        const reminder = await prisma.reminder.create({
            data: {
                content,
                dueDate,
                completed: false
            }
        });

        // 稍微增加一点宠物经验
        await addPetExperience(10, 'reminder');

        return NextResponse.json(reminder, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 });
    }
}

// PATCH: 更新状态 (完成/取消完成)
export async function PATCH(request: Request) {
    try {
        const { id, completed } = await request.json();
        const reminder = await prisma.reminder.update({
            where: { id },
            data: { completed }
        });

        if (completed) {
            await addPetExperience(15, 'reminder_done');
        }

        return NextResponse.json(reminder);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 });
    }
}

// DELETE: 删除提醒
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        await prisma.reminder.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 });
    }
}
