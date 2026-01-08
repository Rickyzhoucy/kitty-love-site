import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 升级所需经验值计算
function getRequiredExp(level: number): number {
    if (level <= 10) return 100;
    if (level <= 25) return 200;
    if (level <= 50) return 350;
    return 500;
}

// 根据等级获取进化阶段
function getEvolution(level: number): number {
    if (level <= 10) return 1; // 幼年期
    if (level <= 25) return 2; // 成长期
    if (level <= 50) return 3; // 成熟期
    return 4; // 闪耀期
}

// 计算离线衰减
function calculateDecay(lastVisit: Date, currentHunger: number, currentHappiness: number) {
    const now = new Date();
    const hoursPassed = (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60);

    // 每小时衰减 2 点，最低为 0
    const decayAmount = Math.floor(hoursPassed * 2);
    const newHunger = Math.max(0, currentHunger - decayAmount);
    const newHappiness = Math.max(0, currentHappiness - Math.floor(decayAmount * 0.5));

    return { hunger: newHunger, happiness: newHappiness };
}

// 检查是否需要重置每日限制
function checkDailyReset(dailyActions: Record<string, { count: number; date: string }>): Record<string, { count: number; date: string }> {
    const today = new Date().toISOString().split('T')[0];
    const result: Record<string, { count: number; date: string }> = {};

    for (const [key, value] of Object.entries(dailyActions)) {
        if (value.date === today) {
            result[key] = value;
        } else {
            result[key] = { count: 0, date: today };
        }
    }

    return result;
}

// GET - 获取宠物状态
export async function GET() {
    try {
        // 尝试获取现有宠物，如果没有则创建一个
        let pet = await prisma.pet.findFirst();

        if (!pet) {
            pet = await prisma.pet.create({
                data: {}
            });
        } else {
            // 计算离线衰减
            const decay = calculateDecay(pet.lastVisitAt, pet.hunger, pet.happiness);
            const dailyActions = checkDailyReset(pet.dailyActions as Record<string, { count: number; date: string }>);

            // 更新状态
            pet = await prisma.pet.update({
                where: { id: pet.id },
                data: {
                    hunger: decay.hunger,
                    happiness: decay.happiness,
                    lastVisitAt: new Date(),
                    dailyActions
                }
            });
        }

        return NextResponse.json(pet);
    } catch (error) {
        console.error('GET /api/pet error:', error);
        return NextResponse.json({ error: 'Failed to fetch pet' }, { status: 500 });
    }
}

// PATCH - 更新宠物状态
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { action, name, color, customSprite, equippedItems } = body;

        const pet = await prisma.pet.findFirst();
        if (!pet) {
            return NextResponse.json({ error: 'Pet not found' }, { status: 404 });
        }

        const dailyActions = pet.dailyActions as Record<string, { count: number; date: string }>;
        const today = new Date().toISOString().split('T')[0];
        let updates: Record<string, unknown> = {};
        let expGained = 0;

        switch (action) {
            case 'feed': {
                // 检查每日喂食次数
                const feedAction = dailyActions.feed || { count: 0, date: today };
                if (feedAction.date !== today) feedAction.count = 0;

                if (feedAction.count >= 3) {
                    return NextResponse.json({ error: '今天喂食次数已达上限 (3次)', limited: true }, { status: 400 });
                }

                updates = {
                    hunger: Math.min(100, pet.hunger + 30),
                    lastFedAt: new Date(),
                    dailyActions: {
                        ...dailyActions,
                        feed: { count: feedAction.count + 1, date: today }
                    }
                };
                expGained = 10;
                break;
            }

            case 'play': {
                // 检查每日玩耍次数
                const playAction = dailyActions.play || { count: 0, date: today };
                if (playAction.date !== today) playAction.count = 0;

                if (playAction.count >= 5) {
                    return NextResponse.json({ error: '今天玩耍次数已达上限 (5次)', limited: true }, { status: 400 });
                }

                updates = {
                    happiness: Math.min(100, pet.happiness + 20),
                    hunger: Math.max(0, pet.hunger - 5), // 玩耍消耗体力
                    lastPlayAt: new Date(),
                    dailyActions: {
                        ...dailyActions,
                        play: { count: playAction.count + 1, date: today }
                    }
                };
                expGained = 15;
                break;
            }

            case 'rename':
                if (!name || name.trim().length === 0) {
                    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
                }
                updates = { name: name.trim() };
                break;

            case 'changeColor':
                if (!color) {
                    return NextResponse.json({ error: 'Color is required' }, { status: 400 });
                }
                updates = { color };
                break;

            case 'customSprite':
                updates = { customSprite: customSprite || null };
                break;

            case 'updateMode':
                if (!body.mode || !['live2d', 'classic'].includes(body.mode)) {
                    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
                }
                updates = {
                    mode: body.mode,
                    customSprite: body.customSprite !== undefined ? body.customSprite : pet.customSprite
                };
                break;

            case 'equip':
                updates = { equippedItems: equippedItems || {} };
                break;

            default:
                return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        // 计算新经验和等级
        let newExp = pet.experience + expGained;
        let newLevel = pet.level;
        let leveledUp = false;

        while (newExp >= getRequiredExp(newLevel)) {
            newExp -= getRequiredExp(newLevel);
            newLevel++;
            leveledUp = true;
        }

        const newEvolution = getEvolution(newLevel);
        const evolved = newEvolution > pet.evolution;

        // 解锁新配饰
        let accessories = pet.accessories as string[];
        if (evolved) {
            const newAccessories = getEvolutionRewards(newEvolution);
            accessories = [...new Set([...accessories, ...newAccessories])];
        }

        const updatedPet = await prisma.pet.update({
            where: { id: pet.id },
            data: {
                ...updates,
                experience: newExp,
                level: newLevel,
                evolution: newEvolution,
                accessories
            }
        });

        return NextResponse.json({
            pet: updatedPet,
            expGained,
            leveledUp,
            evolved
        });

    } catch (error) {
        console.error('PATCH /api/pet error:', error);
        return NextResponse.json({ error: 'Failed to update pet' }, { status: 500 });
    }
}

// 获取进化阶段奖励
function getEvolutionRewards(evolution: number): string[] {
    switch (evolution) {
        case 2: return ['bow', 'scarf']; // 成长期解锁
        case 3: return ['crown', 'glasses']; // 成熟期解锁
        case 4: return ['wings', 'halo']; // 闪耀期解锁
        default: return [];
    }
}
