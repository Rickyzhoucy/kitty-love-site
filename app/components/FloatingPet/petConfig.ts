// 宠物配置常量
export const PET_CONFIG = {
    // 进化阶段名称
    evolutionNames: {
        1: '幼年期',
        2: '成长期',
        3: '成熟期',
        4: '闪耀期'
    } as Record<number, string>,

    // 可用颜色
    colors: [
        { id: 'pink', name: '粉色', color: '#FFB6C1', unlockLevel: 1 },
        { id: 'blue', name: '蓝色', color: '#87CEEB', unlockLevel: 5 },
        { id: 'yellow', name: '黄色', color: '#FFE4B5', unlockLevel: 10 },
        { id: 'green', name: '绿色', color: '#98FB98', unlockLevel: 15 },
        { id: 'purple', name: '紫色', color: '#DDA0DD', unlockLevel: 20 },
        { id: 'rainbow', name: '彩虹', color: 'linear-gradient(45deg, #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #6f42c1)', unlockLevel: 30 }
    ],

    // 配饰
    accessories: [
        { id: 'bow', name: '蝴蝶结', emoji: '🎀', evolution: 2 },
        { id: 'scarf', name: '围巾', emoji: '🧣', evolution: 2 },
        { id: 'crown', name: '皇冠', emoji: '👑', evolution: 3 },
        { id: 'glasses', name: '眼镜', emoji: '👓', evolution: 3 },
        { id: 'wings', name: '翅膀', emoji: '🦋', evolution: 4 },
        { id: 'halo', name: '光环', emoji: '✨', evolution: 4 }
    ],

    // 宠物表情/状态
    moods: {
        happy: '😺',
        normal: '🐱',
        hungry: '😿',
        sleepy: '😸',
        excited: '😻'
    },

    // 升级所需经验
    getRequiredExp: (level: number): number => {
        if (level <= 10) return 100;
        if (level <= 25) return 200;
        if (level <= 50) return 350;
        return 500;
    },

    // 获取宠物心情
    getMood: (hunger: number, happiness: number): string => {
        if (hunger < 30) return 'hungry';
        if (happiness > 80) return 'excited';
        if (happiness > 50) return 'happy';
        if (happiness < 30) return 'sleepy';
        return 'normal';
    }
};

export type PetState = {
    id: string;
    name: string;
    level: number;
    experience: number;
    happiness: number;
    hunger: number;
    evolution: number;
    color: string;
    accessories: string[];
    equippedItems: Record<string, string>;
    customSprite: string | null;
    mode: 'live2d' | 'classic';
    dailyActions: Record<string, { count: number; date: string }>;
    createdAt: string;
    updatedAt: string;
};
