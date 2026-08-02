'use client';

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    BookHeart,
    CalendarHeart,
    Drumstick,
    Leaf,
    MessageCircleHeart,
    BellRing,
    Moon,
    PartyPopper,
    PawPrint,
    Pencil,
    Footprints,
    Palette,
    Ruler,
    Volleyball,
    type LucideIcon,
} from 'lucide-react';
import { streamChat } from '@/lib/api/chat';
import type { AgentTaskEvent } from '@/lib/api/events';
import { recordPetEvent } from '@/lib/api/petCognition';
import { uploadAttachment, type Attachment } from '@/lib/api/attachments';
import { ApiError } from '@/lib/api/client';
import { useChatNudge } from '../ChatMediationProvider';
import DailyRitualPanel from '../DailyRitualPanel';
import SpeechBubble from './SpeechBubble';
import styles from './FloatingPet.module.css';
import { DESKTOP_PET_ROUTE, openMainWindow, requestPetWindowRoom } from '@/lib/desktopPet';
import { PET_ASSETS, type PetAssetId } from './petConfig';
import type { PetInitiative } from './petBodyProtocol';
import { usePet } from './usePet';
import { usePetActivityBridge } from './usePetActivityBridge';
import { usePetBrain } from './usePetBrain';
import { usePetInteraction } from './usePetInteraction';
import { PET_SIZES, usePetSize } from './usePetSize';
import PetBodyRenderer from './renderers/PetBodyRenderer';

type MenuType =
    | 'none'
    | 'main'
    | 'appearance'
    | 'actions'
    | 'rename'
    | 'settings'
    | 'size';

const MENU_TITLES: Record<Exclude<MenuType, 'none' | 'main'>, string> = {
    actions: '动作',
    appearance: '外观',
    size: '大小',
    settings: '主动性',
    rename: '改名',
};

type PetActionId = 'calm' | 'walk' | 'sleep' | 'play' | 'feed' | 'cheer';

const PET_ACTIONS: { id: PetActionId; icon: LucideIcon; label: string }[] = [
    { id: 'calm', icon: Leaf, label: '安静待着' },
    { id: 'walk', icon: Footprints, label: '走两步' },
    { id: 'sleep', icon: Moon, label: '睡一会儿' },
    { id: 'play', icon: Volleyball, label: '玩耍' },
    { id: 'feed', icon: Drumstick, label: '吃东西' },
    { id: 'cheer', icon: PartyPopper, label: '开心一下' },
];

const INITIATIVE_OPTIONS: { id: PetInitiative; label: string; hint: string }[] = [
    { id: 'normal', label: '偶尔主动', hint: '会自己走动，偶尔搭句话' },
    { id: 'quiet', label: '安静模式', hint: '照常生活，但很少打扰你' },
    { id: 'off', label: '完全安静', hint: '只在你叫它的时候动' },
];

export default function FloatingPet() {
    const pathname = usePathname();
    const shouldSkip = pathname?.startsWith('/admin') || pathname?.startsWith('/verify');
    /**
     * 这一份是不是跑在**独立的宠物窗口**里（见 lib/desktopPet.ts）。
     *
     * 桌面宠物窗口是一块铺在桌面上的透明矩形，交互规则和网页里不一样：
     * 网页里「点哪儿它走哪儿」很讨喜，但在桌面上你点的是图标、是别的应用，
     * 宠物没理由因此挪窝。所以那边把点击走动关掉，走动改由菜单触发。
     */
    const isPetWindow = pathname === DESKTOP_PET_ROUTE;
    const { pet, loading, rename, setAssetId, refetch } = usePet(shouldSkip);
    const [menuType, setMenuType] = useState<MenuType>('none');
    const [speech, setSpeech] = useState<string | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [ritualOpen, setRitualOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [initiative, setInitiative] = useState<PetInitiative>('normal');
    const { size, setSize, scale } = usePetSize();
    const bodyRef = useRef<HTMLElement | null>(null);
    const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showSpeech = useCallback((text: string, duration = 3_000) => {
        if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
        setSpeech(text);
        if (duration > 0) {
            speechTimerRef.current = setTimeout(() => setSpeech(null), duration);
        }
    }, []);

    const {
        bodyState,
        setActivity,
        suggestTask,
        setFacing,
        react,
        markInteraction,
        agentThought,
    } = usePetBrain({ bodyRef, initiative, petId: pet?.id, pathname, disabled: shouldSkip });

    // Cognition Agent 想说的话。它是主动搭话，所以必须上报被接住还是被推开——
    // 服务端的 `userDismissalRate` 全靠这个数据自动降频（架构文档 §10）。
    // 没有反馈闭环的话，那个字段就只是个永远为 0 的摆设。
    useEffect(() => {
        if (!agentThought?.utterance) return;
        showSpeech(agentThought.utterance, 8_000);

        let settled = false;
        const report = (accepted: boolean) => {
            if (settled) return;
            settled = true;
            void recordPetEvent(
                accepted ? 'proactive.accepted' : 'proactive.dismissed',
                { goal: agentThought.goal, reason: agentThought.reason },
                accepted ? 70 : 55,
            );
        };
        // 搭话之后马上有互动，就算接住了；一直没动静才算被推开。
        const onEngage = () => report(true);
        window.addEventListener('pointerdown', onEngage, { once: true });
        window.addEventListener('keydown', onEngage, { once: true });
        const timer = setTimeout(() => report(false), 9_000);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointerdown', onEngage);
            window.removeEventListener('keydown', onEngage);
        };
    }, [agentThought, showSpeech]);

    // 聊天未读的中介催促（chat/mediate）。站点级轮询，见 ChatMediationProvider——
    // 挪到这儿之前，催促逻辑长在 /chat 页面里，而那页一打开就会把未读清零，
    // 导致提醒永远赶不上已读、实际上从没被人看到过。
    const [nudge, consumeNudge] = useChatNudge();
    useEffect(() => {
        if (!nudge) return;
        showSpeech(nudge.body, 8_000);
        consumeNudge();
    }, [nudge, consumeNudge, showSpeech]);

    const activityBridge = usePetActivityBridge({
        disabled: shouldSkip,
        setActivity,
        suggestTask,
        react,
        showSpeech,
        refetchPet: refetch,
    });
    const handleHeldChange = useCallback((held: boolean) => {
        setActivity(held ? 'held' : 'idle');
    }, [setActivity]);
    const handleWalkingChange = useCallback((walking: boolean) => {
        setActivity(walking ? 'walking' : 'idle');
    }, [setActivity]);
    const handleTap = useCallback((area: 'head' | 'body') => {
        react(area === 'head' ? 'tapHead' : 'tapBody');
        markInteraction('pet');
    }, [markInteraction, react]);
    const handleMove = useCallback(() => {
        markInteraction('drag');
    }, [markInteraction]);
    const handleOpenMenu = useCallback(() => {
        setSpeech(null);
        setMenuType(current => current === 'none' ? 'main' : 'none');
    }, []);
    const {
        position,
        moving,
        travelMs,
        dragging,
        petButtonProps,
    } = usePetInteraction({
        bodyRef,
        disabled: shouldSkip,
        onFacing: setFacing,
        onHeldChange: handleHeldChange,
        onWalkingChange: handleWalkingChange,
        onLand: () => react('land'),
        onTap: handleTap,
        onOpenMenu: handleOpenMenu,
        onInteraction: handleMove,
        sizeToken: size,
        clickToWalk: !isPetWindow,
    });

    useEffect(() => {
        if (shouldSkip) return;
        setConversationId(localStorage.getItem('companionConversationId'));
        const savedInitiative = localStorage.getItem('companionPetInitiative');
        if (savedInitiative === 'normal' || savedInitiative === 'quiet' || savedInitiative === 'off') {
            setInitiative(savedInitiative);
        }
        return () => {
            if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
        };
    }, [shouldSkip]);

    const sendMessage = async (input = chatInput.trim()) => {
        const message = input || (pendingAttachments.length ? '请查看我发的附件' : '');
        if (!message || sending || uploading) return;
        setChatInput('');
        // 说完就把输入面板收起来，让位给气泡。两块都是浮在宠物头上的卡片，
        // 同时开着会叠在一起——而且这块面板本来就是个「发起」入口（几个快捷
        // 短语 + 一个输入框），不是聊天记录，记录在对话本里。
        setChatOpen(false);
        setSending(true);
        markInteraction('chat');
        activityBridge.beginThinking();
        let reply = '';
        const handleEvent = (event: Parameters<typeof streamChat>[1] extends
            (value: infer Event) => void ? Event : never) => {
            if (event.type === 'text.delta') {
                reply += event.delta;
                showSpeech(reply, 0);
                // 开始说话就不再需要任务状态占着身体了，气泡本身就是反馈。
                activityBridge.endTask();
            } else if (event.type.startsWith('agent.task.')) {
                // 身体表现只跟语义层走。tool.* 仍在流里，但那是审计用的，
                // 工具名对宠物没有意义——见 usePetActivityBridge 的映射表。
                activityBridge.applyTaskEvent(event as AgentTaskEvent);
            } else if (event.type === 'pet.action') {
                activityBridge.playPetAction(event);
            } else if (event.type === 'message.completed') {
                setConversationId(event.conversationId);
                localStorage.setItem('companionConversationId', event.conversationId);
            }
        };
        const run = (id: string | null) => streamChat({
            conversationId: id,
            message,
            attachmentIds: pendingAttachments.map(item => item.id),
        }, handleEvent);
        try {
            try {
                await run(conversationId);
            } catch (error) {
                if (!(error instanceof ApiError) || error.status !== 404 || !conversationId) {
                    throw error;
                }
                localStorage.removeItem('companionConversationId');
                setConversationId(null);
                reply = '';
                await run(null);
            }
            setPendingAttachments([]);
        } catch (error) {
            showSpeech(error instanceof Error ? error.message : '网络好像有点问题');
            activityBridge.fail();
        } finally {
            setSending(false);
            activityBridge.endTask();
        }
    };

    const attachFiles = async (files: FileList | null) => {
        if (!files?.length || uploading) return;
        setUploading(true);
        try {
            const remaining = Math.max(0, 8 - pendingAttachments.length);
            const uploaded = await Promise.all(
                Array.from(files).slice(0, remaining).map(uploadAttachment),
            );
            setPendingAttachments(current => [...current, ...uploaded].slice(0, 8));
        } catch (error) {
            showSpeech(error instanceof Error ? error.message : '附件上传失败');
        } finally {
            setUploading(false);
        }
    };

    const submitRename = async () => {
        const name = newName.trim();
        if (!name) return;
        if (await rename(name)) {
            showSpeech(`以后就叫我 ${name} 吧`);
            setNewName('');
            setMenuType('none');
        } else {
            showSpeech('改名失败，请重试');
        }
    };

    const chooseAppearance = async (assetId: PetAssetId) => {
        if (await setAssetId(assetId)) {
            setMenuType('none');
            setActivity('idle');
            react('celebrate');
            showSpeech('新造型登场啦');
        } else {
            showSpeech('更换造型失败，请重试');
        }
    };

    /**
     * 托盘菜单发过来的动作。
     *
     * 桌面版的宠物窗口是无边框的，没地方放按钮，所以「走两步」这类动作要能从
     * 托盘触发。Rust 侧只发一个信号（见 DesktopPetBridge），**动作本身仍然
     * 走这边同一套** —— 步态、朝向、避障没有第二份实现。
     */
    /**
     * 宠物窗口里，菜单/对话/仪式面板一打开就得先把窗口撑大——
     * 两百像素的窗口装不下它们，不撑大的话右键了也「什么都没出现」，
     * 因为面板被窗口边界整个裁掉了。
     */
    useEffect(() => {
        if (!isPetWindow) return;
        const needsRoom = menuType !== 'none' || chatOpen || ritualOpen;
        void requestPetWindowRoom(needsRoom);
    }, [isPetWindow, menuType, chatOpen, ritualOpen]);

    useEffect(() => {
        if (shouldSkip) return;
        const handle = (event: Event) => {
            const detail = (event as CustomEvent<{ action: string; duration: number }>).detail;
            if (!detail) return;
            activityBridge.playPetAction(detail as Parameters<typeof activityBridge.playPetAction>[0]);
        };
        window.addEventListener('kitty-pet-action', handle);
        return () => window.removeEventListener('kitty-pet-action', handle);
    }, [activityBridge, shouldSkip]);

    /** 菜单里的动作。刻意不关闭菜单——连着喂两次、玩一会儿是常见操作。 */
    const runAction = (id: PetActionId) => {
        switch (id) {
            case 'calm':
                setActivity('idle');
                break;
            case 'walk':
                activityBridge.playPetAction({ action: 'walking', duration: 2_600 });
                break;
            case 'sleep':
                setActivity('sleeping');
                break;
            case 'play':
                markInteraction('play');
                activityBridge.playPetAction({ action: 'play' });
                break;
            case 'feed':
                markInteraction('feed');
                activityBridge.playPetAction({ action: 'eat' });
                break;
            case 'cheer':
                activityBridge.playPetAction({ action: 'celebrate' });
                break;
        }
    };

    const changeInitiative = (next: PetInitiative) => {
        setInitiative(next);
        localStorage.setItem('companionPetInitiative', next);
        setMenuType('none');
        showSpeech(next === 'off'
            ? '我会安静陪着你'
            : next === 'quiet'
                ? '我会少一点打扰'
                : '我会偶尔自己活动');
    };

    if (shouldSkip) return null;

    const petEmoji = PET_ASSETS.find(asset => asset.id === pet?.assetId)?.emoji ?? '🐾';
    // 气泡贴着宠物所在的那一侧展开。`position.right` 是离右边缘的距离，所以它
    // 大于半个视口宽就说明宠物在左半边，气泡该左对齐——否则会往屏幕外伸。
    // SSR 时没有 window，默认按右边算（宠物的初始位置就在右下角）。
    const bubbleSide: 'left' | 'right' =
        typeof window !== 'undefined' && position.right > window.innerWidth / 2
            ? 'left'
            : 'right';

    return (
        <aside
            ref={bodyRef}
            className={`${styles.container} ${moving ? styles.moving : ''} ${dragging ? styles.dragging : ''}`}
            style={isPetWindow
                ? ({
                    // 宠物窗口里不按 right/bottom 贴角——窗口本身就只有宠物那么大，
                    // 贴角会让它压在窗口边上、气泡还被裁掉。居中放。
                    '--pet-scale': scale,
                    '--pet-travel-ms': `${travelMs}ms`,
                } as CSSProperties)
                : ({
                    right: position.right,
                    bottom: position.bottom,
                    '--pet-scale': scale,
                    '--pet-travel-ms': `${travelMs}ms`,
                } as CSSProperties)}
            aria-label="伴侣宠物"
            data-no-pet-walk
            // 透明窗里只有标了这个的元素接收鼠标事件，其余一律穿透到桌面。
            // 见 globals.css 里 [data-desktop-pet] 那一节。
            data-pet-hit
        >
            {chatOpen && (
                <section
                    className={styles.panel}
                    aria-label={`与 ${pet?.name ?? '伴侣'} 对话`}
                    // 声明为障碍物，宠物不会站到面板上（见 platform/environment.ts）。
                    // 加新面板时在那个面板上加这个属性，而不是回去改一份选择器清单。
                    data-pet-obstacle
                >
                    <header className={styles.panelHeader}>
                        <strong>与 {pet?.name ?? '伴侣'} 对话</strong>
                        <button type="button" onClick={() => setChatOpen(false)} aria-label="关闭对话">×</button>
                    </header>
                    <div className={styles.chips}>
                        {['今天有什么计划', '我们想一起做什么来着', '帮我写一段话'].map(prompt => (
                            <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                                {prompt}
                            </button>
                        ))}
                    </div>
                    <div className={styles.chatInput}>
                        <input
                            value={chatInput}
                            onChange={event => setChatInput(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void sendMessage();
                            }}
                            placeholder="说点什么…"
                            aria-label="对话内容"
                            autoFocus
                        />
                        <button type="button" onClick={() => void sendMessage()} disabled={sending}>
                            {sending ? '…' : '发送'}
                        </button>
                    </div>
                    <div className={styles.attachments}>
                        <label>
                            <input
                                type="file"
                                multiple
                                onChange={event => {
                                    void attachFiles(event.target.files);
                                    event.target.value = '';
                                }}
                                disabled={uploading || pendingAttachments.length >= 8}
                            />
                            {uploading ? '上传中…' : '＋ 图片/文件'}
                        </label>
                        {pendingAttachments.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setPendingAttachments(current =>
                                    current.filter(candidate => candidate.id !== item.id))}
                                title="移除附件"
                            >
                                {item.filename} ×
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {ritualOpen && (
                <div className={styles.ritualPanel}>
                    <DailyRitualPanel onClose={() => setRitualOpen(false)} />
                </div>
            )}

            {speech && (
                <SpeechBubble
                    text={speech}
                    petName={pet?.name ?? '它'}
                    petEmoji={petEmoji}
                    side={bubbleSide}
                    onClose={() => setSpeech(null)}
                />
            )}

            {menuType !== 'none' && (
                <section className={styles.menu} aria-label="伴侣菜单" data-pet-obstacle>
                    <header className={styles.menuHeader}>
                        {menuType === 'main' ? (
                            <span className={styles.menuTitle}>{pet?.name ?? '伴侣'}</span>
                        ) : (
                            <button
                                type="button"
                                className={styles.menuBack}
                                onClick={() => setMenuType('main')}
                            >
                                ‹ {MENU_TITLES[menuType]}
                            </button>
                        )}
                        <button
                            type="button"
                            className={styles.menuClose}
                            onClick={() => setMenuType('none')}
                            aria-label="关闭菜单"
                        >
                            ×
                        </button>
                    </header>

                    {menuType === 'main' && (
                        <div className={styles.tileGrid}>
                            <button type="button" className={styles.tile}
                                onClick={() => { setChatOpen(true); setMenuType('none'); }}>
                                <MessageCircleHeart size={19} className={styles.tileIcon} aria-hidden />说句话
                            </button>
                            {/* 一问 / 心情 / 情书。三个都是每天最多碰一次的小事，
                                原本各占一个导航 tab，把真正常用的东西挤没了。 */}
                            <button type="button" className={styles.tile}
                                onClick={() => { setRitualOpen(true); setMenuType('none'); }}>
                                <CalendarHeart size={19} className={styles.tileIcon} aria-hidden />今天
                            </button>
                            {/* **宠物窗口里不能用 Link。** 那个窗口只有两百像素宽，
                                导航过去等于把整个站点塞进一个小方块，而且宠物本身
                                就没了。改成把主窗口叫到前面来——桌面版的「去看对话本」
                                本来就该发生在主界面里。 */}
                            {isPetWindow ? (
                                <button
                                    type="button"
                                    className={styles.tile}
                                    onClick={() => { void openMainWindow(); setMenuType('none'); }}
                                >
                                    <BookHeart size={19} className={styles.tileIcon} aria-hidden />主界面
                                </button>
                            ) : (
                                <Link href="/companion" className={styles.tile} onClick={() => setMenuType('none')}>
                                    <BookHeart size={19} className={styles.tileIcon} aria-hidden />对话本
                                </Link>
                            )}
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('actions')}>
                                <PawPrint size={19} className={styles.tileIcon} aria-hidden />动作
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('appearance')}>
                                <Palette size={19} className={styles.tileIcon} aria-hidden />外观
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('size')}>
                                <Ruler size={19} className={styles.tileIcon} aria-hidden />大小
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('settings')}>
                                <BellRing size={19} className={styles.tileIcon} aria-hidden />主动性
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('rename')}>
                                <Pencil size={19} className={styles.tileIcon} aria-hidden />改名
                            </button>
                        </div>
                    )}

                    {/* 动作**不自动关闭菜单**：想连着喂两次、玩一会儿是常见的，
                        改造前每点一下就要重新翻开菜单。 */}
                    {menuType === 'actions' && (
                        <div className={styles.tileGrid}>
                            {PET_ACTIONS.map(action => (
                                <button
                                    key={action.id}
                                    type="button"
                                    className={styles.tile}
                                    onClick={() => runAction(action.id)}
                                >
                                    <action.icon size={19} className={styles.tileIcon} aria-hidden />{action.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {menuType === 'appearance' && (
                        <div className={styles.assetGrid}>
                            {PET_ASSETS.map(asset => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    className={styles.assetTile}
                                    aria-pressed={pet?.assetId === asset.id}
                                    onClick={() => void chooseAppearance(asset.id)}
                                >
                                    <span aria-hidden="true">{asset.emoji}</span>{asset.name}
                                </button>
                            ))}
                        </div>
                    )}

                    {menuType === 'size' && (
                        <div className={styles.segmented} role="group" aria-label="宠物大小">
                            {PET_SIZES.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-pressed={size === option.id}
                                    onClick={() => setSize(option.id)}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {menuType === 'settings' && (
                        <div className={styles.optionList}>
                            {INITIATIVE_OPTIONS.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={styles.optionRow}
                                    aria-pressed={initiative === option.id}
                                    onClick={() => changeInitiative(option.id)}
                                >
                                    <strong>{option.label}</strong>
                                    <small>{option.hint}</small>
                                </button>
                            ))}
                        </div>
                    )}

                    {menuType === 'rename' && (
                        <div className={styles.rename}>
                            <input
                                value={newName}
                                onChange={event => setNewName(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') void submitRename();
                                }}
                                placeholder={pet?.name ?? '新名字'}
                                aria-label="宠物新名字"
                                autoFocus
                            />
                            <button type="button" onClick={() => void submitRename()}>确定</button>
                        </div>
                    )}
                </section>
            )}

            {/* 宠物窗口里，拖宠物 = 拖**整个窗口**（窗口只有它那么大，
                在窗口内部挪位置没有意义，还会被边界裁掉）。

                **必须是 `deep`，不能只写 `data-tauri-drag-region`。**
                Tauri 只认「鼠标正下方那个元素**自己**带没带这个属性」，不看祖先。
                而按钮里装着宠物的图，鼠标压着的是那张 img，所以光标着的属性
                根本不生效——表现就是「按住宠物怎么拖都不动」。
                `deep`（Tauri 2.11+）会让不可点击的子元素也参与拖动。

                代价是**左键被拖动接管了，onClick 不再可靠**，所以菜单改成右键
                （`onContextMenu`）——桌宠本来也就该是右键出菜单，顺带还满足了
                「点一下不要随便触发东西」。 */}
            <button
                type="button"
                className={styles.petButton}
                {...(isPetWindow ? {} : petButtonProps)}
                {...(isPetWindow ? { 'data-tauri-drag-region': 'deep' } : {})}
                onContextMenu={isPetWindow
                    ? (event) => { event.preventDefault(); handleOpenMenu(); }
                    : undefined}
                onDoubleClick={isPetWindow ? handleOpenMenu : undefined}
                aria-label={loading ? '正在加载伴侣宠物' : `打开 ${pet?.name ?? '伴侣'} 菜单`}
            >
                {loading || !pet ? (
                    <span className={styles.loading}>🐾</span>
                ) : (
                    <PetBodyRenderer
                        assetId={pet.assetId ?? 'kitty'}
                        {...bodyState}
                        className={styles.frames}
                        onError={error => console.error('Pet body asset failed', error)}
                    />
                )}
            </button>

            {/* 对话入口的小气泡按钮。
                **宠物窗口里不出现**：它是按网页布局挂在宠物左下角的，而宠物窗口只有
                两百来像素宽，这个按钮会有一半悬在窗口外——在透明窗上就是桌面角落里
                凭空多出来的半个圆。那边要说话点宠物本体开菜单就行。 */}
            {!chatOpen && !isPetWindow && (
                <button
                    type="button"
                    className={styles.chatButton}
                    onClick={() => { setChatOpen(true); setMenuType('none'); }}
                    aria-label="与伴侣对话"
                >
                    💬
                </button>
            )}
        </aside>
    );
}
