import { urgency, type PetNeeds } from './needs';
import type { PetTraits } from './personality';
import type { PetRelationship } from './relationship';
import type { PetEmotion } from '../petBodyProtocol';

export type { PetEmotion };

export interface PetMood {
    emotion: PetEmotion;
    /** 效价 -1..1，负为难受，正为舒服 */
    valence: number;
    /** 唤醒度 0..1，低为迟钝，高为亢奋 */
    arousal: number;
}

export const NEUTRAL_MOOD: PetMood = { emotion: 'normal', valence: 0, arousal: 0.4 };

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

/**
 * 由需求、性格和关系推导情绪。
 *
 * 情绪不是第七项需求，而是前六项的读数——所以这里没有自己的衰减逻辑，
 * 每 tick 重算即可。
 */
export function computeMood(
    needs: PetNeeds,
    traits: PetTraits,
    relationship: PetRelationship,
): PetMood {
    const need = urgency(needs);

    // 未被满足的需求压低效价，信任度托底
    const discomfort =
        need.hunger * 0.25
        + need.energy * 0.2
        + need.affection * 0.3
        + need.boredom * 0.15
        + need.stress * 0.4;
    const comfort = relationship.trust * 0.35;
    const valence = clamp(comfort - discomfort + 0.25, -1, 1);

    // 精力和好奇心抬高唤醒度，压力也会——但那是不舒服的亢奋
    const arousal = clamp(
        needs.energy * 0.45
        + need.curiosity * 0.2
        + need.stress * 0.25
        + traits.energetic * 0.2,
        0,
        1,
    );

    return { emotion: classify(valence, arousal, need), valence, arousal };
}

function classify(
    valence: number,
    arousal: number,
    need: Record<keyof PetNeeds, number>,
): PetEmotion {
    // 压力压过一切
    if (need.stress > 0.6) return 'sad';
    if (valence < -0.2) return 'sad';
    // 好奇心显著高于其它需求时表现为好奇，而不是笼统的开心
    if (need.curiosity > 0.55 && need.curiosity > need.affection) return 'curious';
    // 低唤醒 + 正效价 = 专注/安定，用于工作与观察
    if (valence > 0.1 && arousal < 0.35) return 'focused';
    if (valence > 0.3) return 'happy';
    return 'normal';
}
