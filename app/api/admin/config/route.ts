import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET: 获取所有配置
export async function GET() {
    try {
        const configs = await prisma.siteConfig.findMany();
        // Convert array to object
        const configMap = configs.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {} as Record<string, string>);

        return NextResponse.json(configMap);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }
}

// POST: 更新配置 (批量更新)
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const updates: any[] = [];
        const historyCreates: any[] = [];

        for (const [key, value] of Object.entries(body as Record<string, string>)) {
            // Check if value actually changed? Ideally yes, but for simplicity we can just log every save or fetch current first.
            // Let's fetch current to avoid spamming history with unchanged values.
            const current = await prisma.siteConfig.findUnique({ where: { key } });

            if (current?.value !== value) {
                // Prepare update
                updates.push(prisma.siteConfig.upsert({
                    where: { key },
                    update: { value },
                    create: { key, value }
                }));

                // Prepare history record
                historyCreates.push(prisma.siteConfigHistory.create({
                    data: { key, value }
                }));
            }
        }

        if (updates.length > 0) {
            await prisma.$transaction([...updates, ...historyCreates]);
        }

        return NextResponse.json({ success: true, updated: updates.length });
    } catch (error) {
        console.error('Update config failed', error);
        return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
    }
}

// DELETE: 重置配置 (删除数据库中的Key，使其回退到硬编码默认值)
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const keys = searchParams.get('keys')?.split(',');

        if (!keys || keys.length === 0) {
            return NextResponse.json({ error: 'Keys required' }, { status: 400 });
        }

        // Create history record for deletion (optional, but good for tracking)
        // We can log that these keys were reset.
        const historyCreates = keys.map(key => prisma.siteConfigHistory.create({
            data: { key, value: '[RESET TO DEFAULT]' }
        }));

        await prisma.$transaction([
            prisma.siteConfig.deleteMany({
                where: { key: { in: keys } }
            }),
            ...historyCreates
        ]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete config failed', error);
        return NextResponse.json({ error: 'Failed to reset config' }, { status: 500 });
    }
}
