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
    if (level <= 10) return 1;
    if (level <= 25) return 2;
    if (level <= 50) return 3;
    return 4;
}

// 获取进化阶段奖励
function getEvolutionRewards(evolution: number): string[] {
    switch (evolution) {
        case 2: return ['bow', 'scarf'];
        case 3: return ['crown', 'glasses'];
        case 4: return ['wings', 'halo'];
        default: return [];
    }
}

interface AddExpParams {
    amount: number;
    source: string;
}

// POST - 增加经验值 (供其他 API 调用)
export async function POST(request: Request) {
    try {
        const body: AddExpParams = await request.json();
        const { amount, source } = body;

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        const pet = await prisma.pet.findFirst();
        if (!pet) {
            return NextResponse.json({ error: 'Pet not found' }, { status: 404 });
        }

        // 计算新经验和等级
        let newExp = pet.experience + amount;
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
                experience: newExp,
                level: newLevel,
                evolution: newEvolution,
                accessories,
                // 增加开心值作为奖励
                happiness: Math.min(100, pet.happiness + 5)
            }
        });

        console.log(`Pet gained ${amount} exp from ${source}. Level: ${newLevel}, Exp: ${newExp}`);

        return NextResponse.json({
            pet: updatedPet,
            expGained: amount,
            source,
            leveledUp,
            evolved
        });

    } catch (error) {
        console.error('POST /api/pet/experience error:', error);
        return NextResponse.json({ error: 'Failed to add experience' }, { status: 500 });
    }
}
