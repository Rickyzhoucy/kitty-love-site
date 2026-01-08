import prisma from '@/lib/prisma';

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

/**
 * 给宠物增加经验值的辅助函数
 * 直接通过 Prisma 操作数据库，避免 HTTP 调用问题
 */
export async function addPetExperience(amount: number, source: string): Promise<void> {
    try {
        const pet = await prisma.pet.findFirst();
        if (!pet) {
            console.log('Pet not found, skipping experience update');
            return;
        }

        // 计算新经验和等级
        let newExp = pet.experience + amount;
        let newLevel = pet.level;

        while (newExp >= getRequiredExp(newLevel)) {
            newExp -= getRequiredExp(newLevel);
            newLevel++;
        }

        const newEvolution = getEvolution(newLevel);
        const evolved = newEvolution > pet.evolution;

        // 解锁新配饰
        let accessories = pet.accessories as string[];
        if (evolved) {
            const newAccessories = getEvolutionRewards(newEvolution);
            accessories = [...new Set([...accessories, ...newAccessories])];
        }

        await prisma.pet.update({
            where: { id: pet.id },
            data: {
                experience: newExp,
                level: newLevel,
                evolution: newEvolution,
                accessories,
                happiness: Math.min(100, pet.happiness + 5)
            }
        });

        console.log(`Pet gained ${amount} exp from ${source}. Level: ${newLevel}, Exp: ${newExp}`);
    } catch (error) {
        console.error('Failed to add pet experience:', error);
    }
}
