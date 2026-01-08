'use client';

// 宠物事件系统 - 用于前端跨组件通信
type PetEventType = 'experience_gained' | 'level_up' | 'evolved' | 'refetch';

interface PetEventData {
    amount?: number;
    source?: string;
    newLevel?: number;
    message?: string;
}

type PetEventListener = (type: PetEventType, data: PetEventData) => void;

const listeners: Set<PetEventListener> = new Set();

export const petEvents = {
    subscribe(listener: PetEventListener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    emit(type: PetEventType, data: PetEventData = {}) {
        listeners.forEach(listener => listener(type, data));
    }
};

// 根据来源获取对话内容
export function getExperienceMessage(source: string, amount: number): string {
    const messages: Record<string, string[]> = {
        message: [
            `主人发了新留言！+${amount}经验 💬`,
            `收到留言啦！开心~ +${amount}经验 ✨`,
        ],
        memo_add: [
            `新备忘录！主人真勤快~ +${amount}经验 📝`,
        ],
        memo_complete: [
            `任务完成！太棒了！+${amount}经验 ✅`,
        ],
        photo: [
            `新照片！好漂亮！+${amount}经验 📷`,
        ],
        milestone: [
            `记录了新故事！+${amount}经验 💕`,
        ],
    };

    const sourceMessages = messages[source] || [`获得 ${amount} 经验！`];
    return sourceMessages[Math.floor(Math.random() * sourceMessages.length)];
}

// 便捷方法：通知宠物获得经验
export function notifyPetExperience(amount: number, source: string) {
    const message = getExperienceMessage(source, amount);
    petEvents.emit('experience_gained', { amount, source, message });
}
