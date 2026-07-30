'use client';

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from 'react';
import {
    recordPetEvent,
    requestCognition,
    type CognitionProposal,
} from '@/lib/api/petCognition';
import { fetchPetState, savePetState } from '@/lib/api/petState';
import {
    createDomPointerSource,
    type PointerSource,
} from './platform/pointerSource';
import {
    IDLE_BODY_STATE,
    type PetBodyState,
    type PetInitiative,
    type PetPersistentActivity,
    type PetReaction,
} from './petBodyProtocol';
import {
    BAND,
    canPreempt,
    claim,
    EMPTY_CLAIMS,
    prune,
    release,
    resolve,
    type ArbiterBand,
    type ClaimStore,
} from './brain/arbiter';
import {
    activityForGoal,
    evaluateGoals,
    isUrgent,
    shouldSwitch,
    type GoalContext,
    type PetGoalId,
} from './brain/goals';
import { computeMood, NEUTRAL_MOOD, type PetMood } from './brain/mood';
import {
    decayNeeds,
    INITIAL_NEEDS,
    relieveNeed,
    settleElapsed,
    type NeedRelief,
    type PetNeeds,
} from './brain/needs';
import { traitsFromSeed, type PetTraits } from './brain/personality';
import {
    INITIAL_RELATIONSHIP,
    registerInteraction,
    rolloverDaily,
    type InteractionKind,
    type PetRelationship,
} from './brain/relationship';

const TICK_MS = 1_000;

/** 模块级单例：每个宠物实例各建一个 DOM 监听没有意义。 */
const DOM_POINTER_SOURCE = createDomPointerSource();
const STORAGE_PREFIX = 'companionPetBrain:';

/**
 * 目标完成时结算的需求收益。
 * sleep 不在此列——精力由 decayNeeds 的 sleeping 分支持续回复，再结算会重复计。
 */
const GOAL_RELIEF: Partial<Record<PetGoalId, NeedRelief>> = {
    eat: 'fed',
    play: 'played',
    explore: 'explored',
    seekAttention: 'petted',
    rest: 'rested',
};

/** 外部命令式调用共用一个 claim 槽位，语义与改造前的单一 activity 一致。 */
const EXTERNAL_SOURCE = 'external';
const GOAL_SOURCE = 'goal';
/** Cognition Agent 的提案槽位。位于自主闲逛之上、生理需求之下。 */
const AGENT_SOURCE = 'agent';
/** Agent 任务的建议槽位，与 EXTERNAL_SOURCE 分开——两者优先级不同，会互相抢占。 */
const TASK_SOURCE = 'task';

/**
 * 任务建议的最长存活时长。
 *
 * 建议一律带过期时间：SSE 断了、后端崩了、终态事件丢了，宠物也会在这之后自己
 * 回到生活状态，而不是永远停在 working。对应架构文档 §16「Agent 超时不会冻结身体」。
 */
const TASK_CLAIM_TTL_MS = 90_000;

/** 由活动类型推断优先级带，让既有调用点无需改签名。 */
function bandForActivity(activity: PetPersistentActivity): ArbiterBand {
    switch (activity) {
        case 'held':
            return BAND.SAFETY;
        case 'thinking':
        case 'working':
            return BAND.TASK_FEEDBACK;
        default:
            return BAND.DIRECT;
    }
}

interface PersistedBrain {
    needs: PetNeeds;
    relationship: PetRelationship;
    savedAt: number;
}

function loadPersisted(petId: string): PersistedBrain | null {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + petId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedBrain;
        if (!parsed?.needs || !parsed?.relationship) return null;
        return parsed;
    } catch {
        return null;
    }
}

function persist(petId: string, needs: PetNeeds, relationship: PetRelationship) {
    try {
        localStorage.setItem(
            STORAGE_PREFIX + petId,
            JSON.stringify({ needs, relationship, savedAt: Date.now() }),
        );
    } catch {
        // 隐私模式下 localStorage 可能不可写，宠物退化为单会话记忆
    }
}

interface UsePetBrainOptions {
    bodyRef: RefObject<HTMLElement | null>;
    initiative: PetInitiative;
    /** 用于派生稳定性格与隔离持久化，缺省时全站共用一只 */
    petId?: string;
    /** 当前路由。变化时抬高好奇心，让宠物对「换了个地方」有反应 */
    pathname?: string | null;
    /** 指针来源。桌面端换成 Rust 侧的全局鼠标实现即可，行为脑无需改动 */
    pointerSource?: PointerSource;
    disabled?: boolean;
}

interface UsePetBrainReturn {
    bodyState: PetBodyState;
    /** 传入 'idle' 表示交还控制权，由行为脑接管 */
    setActivity: (activity: PetPersistentActivity) => void;
    /** 任务状态建议，走 TASK_* 优先级带；传 null 表示任务结束 */
    suggestTask: (activity: PetPersistentActivity | null) => void;
    setFacing: (facing: PetBodyState['facing']) => void;
    react: (reaction: PetReaction) => void;
    markInteraction: (kind?: InteractionKind) => void;
    /** 供调试面板与后续 Cognition Agent 读取 */
    traits: PetTraits;
    needs: PetNeeds;
    mood: PetMood;
    relationship: PetRelationship;
    activeGoal: PetGoalId;
    /** Cognition Agent 最近一次提案；没有就是 null */
    agentThought: CognitionProposal | null;
}

export function usePetBrain({
    bodyRef,
    initiative,
    petId = 'default',
    pathname = null,
    pointerSource = DOM_POINTER_SOURCE,
    disabled = false,
}: UsePetBrainOptions): UsePetBrainReturn {
    const [bodyState, setBodyState] = useState<PetBodyState>(IDLE_BODY_STATE);
    const [needs, setNeeds] = useState<PetNeeds>(INITIAL_NEEDS);
    const [mood, setMood] = useState<PetMood>(NEUTRAL_MOOD);
    const [relationship, setRelationship] = useState<PetRelationship>(INITIAL_RELATIONSHIP);
    const [activeGoal, setActiveGoal] = useState<PetGoalId>('idle');
    /** 最近一次被采纳的 Cognition 提案，供 UI 显示宠物想说的话 */
    const [agentThought, setAgentThought] = useState<CognitionProposal | null>(null);

    const traits = useMemo(() => traitsFromSeed(petId), [petId]);

    const needsRef = useRef(needs);
    const moodRef = useRef(mood);
    const relationshipRef = useRef(relationship);
    const claimsRef = useRef<ClaimStore>(EMPTY_CLAIMS);
    const goalRef = useRef<PetGoalId>('idle');
    /** 当前目标的完成时刻。到点后结算收益并让出，否则目标会永久占位。 */
    const goalEndsAtRef = useRef(0);
    const lastRunAtRef = useRef<Partial<Record<PetGoalId, number>>>({});
    // 0 表示尚未初始化——Date.now() 不能在 render 期求值
    const lastTickRef = useRef(0);
    const lastInteractionRef = useRef(0);
    const pageChangedAtRef = useRef(0);
    const hiddenSinceRef = useRef<number | null>(null);
    const pointerFrameRef = useRef<number | null>(null);
    const pointerRef = useRef({ x: 0, y: 0 });
    const hydratedRef = useRef(false);
    // effect 不直接提交状态，改为入队，由 tick 统一 drain——避免级联渲染
    const pendingNeedsRef = useRef<Array<(needs: PetNeeds) => PetNeeds>>([]);
    const pendingRelationshipRef = useRef<Array<(value: PetRelationship) => PetRelationship>>([]);

    // tick 在 interval 里读这两个 ref，因此需要在每次提交后同步一次
    useEffect(() => { needsRef.current = needs; }, [needs]);
    useEffect(() => { moodRef.current = mood; }, [mood]);
    useEffect(() => {
        // 关系升级是少数几件半年后回头看还值得记得的事，上报给 Reflection
        //（架构文档 §9）。降级不上报——那只会是数据修正，不是经历。
        const previous = relationshipRef.current.level;
        relationshipRef.current = relationship;
        if (relationship.level > previous) {
            void recordPetEvent(
                'interaction.milestone',
                { level: relationship.level, familiarity: relationship.familiarity },
                70,
            );
        }
    }, [relationship]);

    /** 把仲裁结果写回 bodyState。 */
    const applyClaims = useCallback((next: ClaimStore, now: number) => {
        // claim / release / prune 在无变化时返回原数组，这里据此直接短路。
        // 过期造成的结论变化由 tick 里的 prune 负责，不会被这个短路吞掉。
        if (next === claimsRef.current) return;
        claimsRef.current = next;
        const resolved = resolve(next, now);
        setBodyState(current => current.activity === resolved.activity
            ? current
            : { ...current, activity: resolved.activity });
    }, []);

    const react = useCallback((name: PetReaction) => {
        setBodyState(current => ({
            ...current,
            reaction: { name, nonce: (current.reaction?.nonce ?? 0) + 1 },
        }));
    }, []);

    const setActivity = useCallback((activity: PetPersistentActivity) => {
        const now = Date.now();
        if (activity === 'idle') {
            applyClaims(release(claimsRef.current, EXTERNAL_SOURCE), now);
            return;
        }
        applyClaims(claim(claimsRef.current, {
            source: EXTERNAL_SOURCE,
            activity,
            band: bandForActivity(activity),
            expiresAt: null,
            holdUntil: now,
        }), now);
    }, [applyClaims]);

    /**
     * 任务状态的身体建议（架构文档 §6.3）。
     *
     * 刻意叫「建议」而不是「设置」：它进的是 TASK_* 优先级带，被拖动、摸头这些
     * 更高带的 claim 压住时不会生效——行为脑保留最终否决权（§2 原则 4）。
     * 传 null 表示任务结束，交还控制权。
     */
    const suggestTask = useCallback((activity: PetPersistentActivity | null) => {
        const now = Date.now();
        if (activity === null) {
            applyClaims(release(claimsRef.current, TASK_SOURCE), now);
            return;
        }
        applyClaims(claim(claimsRef.current, {
            source: TASK_SOURCE,
            activity,
            // 等用户确认比单纯的状态反馈更急——它挡着任务往下走。
            band: activity === 'asking' ? BAND.TASK_CONFIRM : BAND.TASK_FEEDBACK,
            expiresAt: now + TASK_CLAIM_TTL_MS,
            holdUntil: now,
        }), now);
    }, [applyClaims]);

    const setFacing = useCallback((facing: PetBodyState['facing']) => {
        setBodyState(current => current.facing === facing
            ? current
            : { ...current, facing });
    }, []);

    const markInteraction = useCallback((kind: InteractionKind = 'pet') => {
        const now = Date.now();
        lastInteractionRef.current = now;
        setRelationship(current => registerInteraction(current, kind, now));

        const relief: NeedRelief | null =
            kind === 'pet' ? 'petted'
                : kind === 'play' ? 'played'
                    : kind === 'feed' ? 'fed'
                        : kind === 'chat' ? 'petted'
                            : kind === 'startle' ? 'startled'
                                : null;
        if (relief) {
            setNeeds(current => relieveNeed(current, relief, traits));
        }
        // 被打扰就别装睡了
        if (goalRef.current === 'sleep') {
            goalRef.current = 'idle';
            applyClaims(release(claimsRef.current, GOAL_SOURCE), now);
        }
    }, [applyClaims, traits]);

    // 载入持久化状态，并按离开时长结算。
    //
    // 两级：localStorage 先立刻兜底（宠物不该为了等网络先呆立几百毫秒），
    // 服务端快照到了再覆盖。服务端是权威——换设备时只有它知道真实状态。
    // 拿不到就一直用本地的，离线时宠物照常生活（架构文档 §16）。
    useEffect(() => {
        if (disabled || hydratedRef.current) return;
        hydratedRef.current = true;
        const now = Date.now();
        lastTickRef.current = now;

        const settle = (
            needs: PetNeeds,
            elapsedSeconds: number,
        ) => settleElapsed(needs, traits, Math.max(0, elapsedSeconds), {
            userActive: false,
            sleeping: true,
            pageChanged: false,
        });

        const saved = loadPersisted(petId);
        if (saved) {
            pendingNeedsRef.current.push(
                () => settle(saved.needs, (now - saved.savedAt) / 1_000),
            );
            pendingRelationshipRef.current.push(() => rolloverDaily(saved.relationship, now));
        }

        let cancelled = false;
        void fetchPetState()
            .then(snapshot => {
                if (cancelled || !snapshot.needs) return;
                // elapsedSeconds 已由服务端夹到上限，这里直接用。
                pendingNeedsRef.current.push(
                    () => settle(snapshot.needs as unknown as PetNeeds, snapshot.elapsedSeconds),
                );
                if (snapshot.relationship) {
                    pendingRelationshipRef.current.push(() => rolloverDaily(
                        snapshot.relationship as unknown as PetRelationship,
                        Date.now(),
                    ));
                }
            })
            .catch(() => {
                // 弱网或未登录：继续用本地快照，不打断宠物。
            });
        return () => { cancelled = true; };
    }, [disabled, petId, traits]);

    // 页面导航：抬高好奇心，并让 explore 目标在随后一段时间内更有竞争力
    useEffect(() => {
        if (disabled || !pathname) return;
        pageChangedAtRef.current = Date.now();
        pendingNeedsRef.current.push(current => ({
            ...current,
            curiosity: Math.min(1, current.curiosity + 0.25 * traits.curious),
        }));
    }, [disabled, pathname, traits.curious]);

    // 目光跟随。与需求无关，属实时小脑。
    //
    // 指针来自 PointerSource 而不是直接监听 DOM：桌面端的指针是 Rust 侧的
    // 全局鼠标，坐标系与 DOM 事件不同，且宠物窗口自身也在移动。行为脑不该
    // 知道这个差别（实施计划 §9）。
    useEffect(() => {
        if (disabled) return;
        const updateGaze = () => {
            pointerFrameRef.current = null;
            const bounds = bodyRef.current?.getBoundingClientRect();
            if (!bounds) return;
            const centerX = bounds.left + bounds.width / 2;
            const centerY = bounds.top + bounds.height * 0.35;
            const x = Math.max(-1, Math.min(1, (pointerRef.current.x - centerX) / 260));
            const y = Math.max(-1, Math.min(1, (pointerRef.current.y - centerY) / 220));
            setBodyState(current => {
                if (Math.abs(current.gaze.x - x) < 0.025 && Math.abs(current.gaze.y - y) < 0.025) {
                    return current;
                }
                return { ...current, gaze: { x, y } };
            });
        };
        const unsubscribe = pointerSource.subscribe(position => {
            pointerRef.current = position;
            if (pointerFrameRef.current === null) {
                pointerFrameRef.current = requestAnimationFrame(updateGaze);
            }
        });
        return () => {
            unsubscribe();
            if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
        };
    }, [bodyRef, disabled, pointerSource]);

    // 用户活跃度与页面可见性
    useEffect(() => {
        if (disabled) return;
        const touch = () => { lastInteractionRef.current = Date.now(); };
        const handleVisibility = () => {
            const now = Date.now();
            if (document.hidden) {
                hiddenSinceRef.current = now;
                return;
            }
            const hiddenSince = hiddenSinceRef.current;
            hiddenSinceRef.current = null;
            if (hiddenSince) {
                const elapsed = (now - hiddenSince) / 1_000;
                setNeeds(current => settleElapsed(current, traits, elapsed, {
                    userActive: false,
                    sleeping: goalRef.current === 'sleep',
                    pageChanged: false,
                }));
            }
            lastTickRef.current = now;
            touch();
        };
        window.addEventListener('keydown', touch);
        window.addEventListener('pointerdown', touch);
        window.addEventListener('scroll', touch, { passive: true });
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.removeEventListener('keydown', touch);
            window.removeEventListener('pointerdown', touch);
            window.removeEventListener('scroll', touch);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [disabled, traits]);

    // 行为脑主循环
    useEffect(() => {
        if (disabled) return;
        const interval = window.setInterval(() => {
            if (document.hidden) return;
            const now = Date.now();

            // 先应用 effect 排队的变更（水合、页面导航等）
            if (pendingNeedsRef.current.length > 0) {
                const mutations = pendingNeedsRef.current;
                pendingNeedsRef.current = [];
                const applied = mutations.reduce((value, mutate) => mutate(value), needsRef.current);
                needsRef.current = applied;
                setNeeds(applied);
            }
            if (pendingRelationshipRef.current.length > 0) {
                const mutations = pendingRelationshipRef.current;
                pendingRelationshipRef.current = [];
                const applied = mutations.reduce((value, mutate) => mutate(value), relationshipRef.current);
                relationshipRef.current = applied;
                setRelationship(applied);
            }

            // 过期的 claim 要在 tick 里主动清掉。resolve 虽然会跳过过期项，但
            // 没有人重新 resolve 的话身体就一直停在旧结论上。
            const pruned = prune(claimsRef.current, now);
            if (pruned !== claimsRef.current) applyClaims(pruned, now);

            if (lastTickRef.current === 0) {
                lastTickRef.current = now;
                return;
            }
            const dt = Math.min(5, (now - lastTickRef.current) / 1_000);
            lastTickRef.current = now;

            const userActive = now - lastInteractionRef.current < 20_000;
            const sleeping = goalRef.current === 'sleep';
            const recentPageChange = now - pageChangedAtRef.current < 15_000;

            const nextNeeds = decayNeeds(needsRef.current, traits, dt, {
                userActive,
                sleeping,
                pageChanged: false,
            });
            needsRef.current = nextNeeds;
            setNeeds(nextNeeds);

            const nextMood = computeMood(nextNeeds, traits, relationshipRef.current);
            setMood(nextMood);
            setBodyState(current => current.emotion === nextMood.emotion
                ? current
                : { ...current, emotion: nextMood.emotion });

            // 目标完成：结算收益、记入冷却、让出占位。
            // 收益必须在完成时结算而非选中时——玩过之后才不无聊，而不是刚开始玩就不无聊。
            let workingNeeds = nextNeeds;
            if (goalRef.current !== 'idle' && now >= goalEndsAtRef.current) {
                const finished = goalRef.current;
                const relief = GOAL_RELIEF[finished];
                if (relief) {
                    workingNeeds = relieveNeed(workingNeeds, relief, traits);
                    needsRef.current = workingNeeds;
                    setNeeds(workingNeeds);
                }
                lastRunAtRef.current = { ...lastRunAtRef.current, [finished]: now };
                goalRef.current = 'idle';
                goalEndsAtRef.current = 0;
                setActiveGoal('idle');
                applyClaims(release(claimsRef.current, GOAL_SOURCE), now);
            }

            const context: GoalContext = {
                userActive,
                documentHidden: false,
                recentPageChange,
                initiative,
                lastRunAt: lastRunAtRef.current,
                now,
            };
            const ranked = evaluateGoals(workingNeeds, traits, relationshipRef.current, context);
            const best = ranked[0];
            if (!best) return;

            // 与当前目标的**实时**分数比较。用选中时的旧分数比较会让分数
            // 随需求单调上涨的目标永久锁死首位。
            // 滞回是否生效由 shouldSwitch 决定——从 idle 起步不收门槛。
            const currentScore = ranked.find(goal => goal.id === goalRef.current)?.score ?? 0;
            if (!shouldSwitch(best, goalRef.current, currentScore)) return;

            const band = isUrgent(best.id, workingNeeds) ? BAND.NEEDS : BAND.IDLE;
            if (!canPreempt(claimsRef.current, GOAL_SOURCE, band, now)) return;

            goalRef.current = best.id;
            goalEndsAtRef.current = now + best.minDurationMs;
            setActiveGoal(best.id);
            applyClaims(claim(claimsRef.current, {
                source: GOAL_SOURCE,
                activity: best.activity,
                band,
                expiresAt: null,
                holdUntil: now + best.minDurationMs,
            }), now);
            if (best.reaction) react(best.reaction);
        }, TICK_MS);
        return () => window.clearInterval(interval);
    }, [applyClaims, disabled, initiative, react, traits]);

    /**
     * 主动认知（架构文档 §10 的第三级）。
     *
     * 只在**罕见的语境**下才问服务端要一个想法：用户在同一页面停留很久，
     * 而且宠物自己也闲着。走路、眨眼、目光跟随、普通闲逛全都不在这里——
     * 那些是「微主动」，本地行为脑自己就能做，绝不该触发模型（§5.1）。
     *
     * 服务端还会再拦一道（预算、防抖、静默模式）。客户端这层不是安全边界，
     * 只是避免把注定被拒的请求发出去。
     */
    useEffect(() => {
        if (disabled || initiative === 'off') return;
        const interval = window.setInterval(() => {
            if (document.hidden) return;
            const now = Date.now();
            const idleFor = now - lastInteractionRef.current;
            const settledFor = now - pageChangedAtRef.current;
            // 闲了 3 分钟以上、且在当前页面稳定待了 1 分钟，才值得想一下。
            if (idleFor < 180_000 || settledFor < 60_000) return;
            if (goalRef.current !== 'idle' && goalRef.current !== 'observe') return;

            void requestCognition({
                type: 'proactive_thought',
                trigger: 'pet.longDwell',
                needs: needsRef.current as unknown as Record<string, number>,
                mood: moodRef.current as unknown as Record<string, unknown>,
                relationship: relationshipRef.current as unknown as Record<string, unknown>,
                page: pathname ?? '',
                localTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                recentInteractions: [],
                activeTask: null,
                initiative,
            }).then(proposal => {
                if (!proposal) return;
                const at = Date.now();
                setAgentThought(proposal);
                // 提案只是建议：进 AGENT 带，位于自主闲逛之上、生理需求之下。
                // 拖动、摸头、任务反馈随时压过去——行为脑保留最终否决权
                //（架构文档 §2 原则 4）。带过期时间，想法过时就自动作废。
                applyClaims(claim(claimsRef.current, {
                    source: AGENT_SOURCE,
                    activity: activityForGoal(proposal.goal),
                    band: BAND.AGENT,
                    expiresAt: at + proposal.expiresIn * 1_000,
                    holdUntil: at,
                }), at);
            });
        }, 60_000);
        return () => window.clearInterval(interval);
    }, [applyClaims, disabled, initiative, pathname]);

    // 节流落盘。
    //
    // localStorage 每 30 秒写一次并在 pagehide 补一刀——它是同步的，页面被
    // 关掉也来得及。服务端快照走同一节奏，但**不挂 pagehide**：那时候的
    // 异步请求大概率发不出去，与其写一个看着像兜底、实际经常失败的调用，
    // 不如把关页面这一档明确交给 localStorage，下次进来由它先兜底。
    useEffect(() => {
        if (disabled) return;
        const snapshot = () => ({
            needs: needsRef.current as unknown as Record<string, number>,
            mood: moodRef.current as unknown as Record<string, unknown>,
            relationship: relationshipRef.current as unknown as Record<string, unknown>,
            activeGoal: goalRef.current,
            traits: traits as unknown as Record<string, number>,
        });
        const pushRemote = () => {
            void savePetState(snapshot()).catch(() => {
                // 弱网时以本地为准，恢复后下一轮自然补上。
            });
        };
        const interval = window.setInterval(() => {
            persist(petId, needsRef.current, relationshipRef.current);
            pushRemote();
        }, 30_000);
        // 切到后台是移动端唯一可靠的「还有机会发请求」时机。
        const handleVisibility = () => {
            if (document.hidden) pushRemote();
        };
        const handleUnload = () => persist(petId, needsRef.current, relationshipRef.current);
        window.addEventListener('pagehide', handleUnload);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('pagehide', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibility);
            persist(petId, needsRef.current, relationshipRef.current);
            pushRemote();
        };
    }, [disabled, petId, traits]);

    return {
        bodyState,
        setActivity,
        suggestTask,
        setFacing,
        react,
        markInteraction,
        traits,
        needs,
        mood,
        relationship,
        activeGoal,
        agentThought,
    };
}
