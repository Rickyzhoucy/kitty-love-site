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
import { streamChat } from '@/lib/api/chat';
import type { AgentTaskEvent } from '@/lib/api/events';
import { recordPetEvent } from '@/lib/api/petCognition';
import { uploadAttachment, type Attachment } from '@/lib/api/attachments';
import { ApiError } from '@/lib/api/client';
import { useChatNudge } from '../ChatMediationProvider';
import styles from './FloatingPet.module.css';
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

const PET_ACTIONS: { id: PetActionId; emoji: string; label: string }[] = [
    { id: 'calm', emoji: '🍃', label: '安静待着' },
    { id: 'walk', emoji: '🚶', label: '走两步' },
    { id: 'sleep', emoji: '😴', label: '睡一会儿' },
    { id: 'play', emoji: '🎾', label: '玩耍' },
    { id: 'feed', emoji: '🍖', label: '吃东西' },
    { id: 'cheer', emoji: '🎉', label: '开心一下' },
];

const INITIATIVE_OPTIONS: { id: PetInitiative; label: string; hint: string }[] = [
    { id: 'normal', label: '偶尔主动', hint: '会自己走动，偶尔搭句话' },
    { id: 'quiet', label: '安静模式', hint: '照常生活，但很少打扰你' },
    { id: 'off', label: '完全安静', hint: '只在你叫它的时候动' },
];

export default function FloatingPet() {
    const pathname = usePathname();
    const shouldSkip = pathname?.startsWith('/admin') || pathname?.startsWith('/verify');
    const { pet, loading, rename, setAssetId, refetch } = usePet(shouldSkip);
    const [menuType, setMenuType] = useState<MenuType>('none');
    const [speech, setSpeech] = useState<string | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
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

    return (
        <aside
            ref={bodyRef}
            className={`${styles.container} ${moving ? styles.moving : ''} ${dragging ? styles.dragging : ''}`}
            style={{
                right: position.right,
                bottom: position.bottom,
                '--pet-scale': scale,
                '--pet-travel-ms': `${travelMs}ms`,
            } as CSSProperties}
            aria-label="伴侣宠物"
            data-no-pet-walk
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

            {speech && (
                <div className={styles.speech} role="status">
                    <span>{speech}</span>
                    <button type="button" onClick={() => setSpeech(null)} aria-label="关闭消息">×</button>
                </div>
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
                                <span aria-hidden="true">💬</span>说句话
                            </button>
                            <Link href="/companion" className={styles.tile} onClick={() => setMenuType('none')}>
                                <span aria-hidden="true">📖</span>对话本
                            </Link>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('actions')}>
                                <span aria-hidden="true">🐾</span>动作
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('appearance')}>
                                <span aria-hidden="true">🎨</span>外观
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('size')}>
                                <span aria-hidden="true">🔍</span>大小
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('settings')}>
                                <span aria-hidden="true">🌙</span>主动性
                            </button>
                            <button type="button" className={styles.tile}
                                onClick={() => setMenuType('rename')}>
                                <span aria-hidden="true">✏️</span>改名
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
                                    <span aria-hidden="true">{action.emoji}</span>{action.label}
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

            <button
                type="button"
                className={styles.petButton}
                {...petButtonProps}
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

            {!chatOpen && (
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
