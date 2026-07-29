'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { streamChat } from '@/lib/api/chat';
import { uploadAttachment, type Attachment } from '@/lib/api/attachments';
import { ApiError } from '@/lib/api/client';
import { subscribeServerEvent, type PetActionEvent } from '@/lib/api/events';
import styles from './FloatingPet.module.css';
import { PET_ASSETS, type PetAssetId } from './petConfig';
import { usePet } from './usePet';
import ManifestFrameRenderer, {
    type PetFrameAction,
} from './renderers/ManifestFrameRenderer';

type MenuType = 'none' | 'main' | 'appearance' | 'actions' | 'rename';

interface DragState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
}

const DEFAULT_POSITION = { right: 20, bottom: 112 };

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
    const [frameAction, setFrameAction] = useState<PetFrameAction>('idle');
    const [position, setPosition] = useState(DEFAULT_POSITION);
    const dragRef = useRef<DragState | null>(null);
    const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showSpeech = useCallback((text: string, duration = 3_000) => {
        if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
        setSpeech(text);
        if (duration > 0) {
            speechTimerRef.current = setTimeout(() => setSpeech(null), duration);
        }
    }, []);

    const playAction = useCallback((action: string, duration = 1_800) => {
        const next: PetFrameAction = action === 'walk'
            ? 'walk'
            : action === 'crawl'
                ? 'crawl'
                : 'idle';
        if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
        setFrameAction(next);
        if (next !== 'idle') {
            actionTimerRef.current = setTimeout(() => setFrameAction('idle'), duration);
        }
    }, []);

    useEffect(() => {
        if (shouldSkip) return;
        setConversationId(localStorage.getItem('companionConversationId'));
        const saved = localStorage.getItem('companionPetPosition');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as typeof DEFAULT_POSITION;
                if (Number.isFinite(parsed.right) && Number.isFinite(parsed.bottom)) {
                    setPosition(parsed);
                }
            } catch {
                localStorage.removeItem('companionPetPosition');
            }
        }
        return () => {
            if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
            if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
        };
    }, [shouldSkip]);

    useEffect(() => {
        if (shouldSkip) return;
        return subscribeServerEvent<PetActionEvent>('pet.action', event => {
            if (event.message) showSpeech(event.message, event.duration ?? 3_000);
            playAction(event.animation ?? event.action, event.duration);
            void refetch();
        });
    }, [playAction, refetch, shouldSkip, showSpeech]);

    const sendMessage = async (input = chatInput.trim()) => {
        const message = input || (pendingAttachments.length ? '请查看我发的附件' : '');
        if (!message || sending || uploading) return;
        setChatInput('');
        setSending(true);
        let reply = '';
        const handleEvent = (event: Parameters<typeof streamChat>[1] extends
            (value: infer Event) => void ? Event : never) => {
            if (event.type === 'text.delta') {
                reply += event.delta;
                showSpeech(reply, 0);
            } else if (event.type === 'tool.started' && !reply) {
                showSpeech(`正在处理：${event.name}…`, 0);
            } else if (event.type === 'pet.action') {
                if (event.message) showSpeech(event.message, event.duration ?? 3_000);
                playAction(event.animation ?? event.action, event.duration);
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
        } finally {
            setSending(false);
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
            setFrameAction('idle');
            showSpeech('新造型登场啦');
        } else {
            showSpeech('更换造型失败，请重试');
        }
    };

    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startRight: position.right,
            startBottom: position.bottom,
            moved: false,
        };
    };

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
        const size = event.currentTarget.getBoundingClientRect();
        setPosition({
            right: Math.max(8, Math.min(window.innerWidth - size.width - 8, drag.startRight - deltaX)),
            bottom: Math.max(88, Math.min(window.innerHeight - size.height - 8, drag.startBottom - deltaY)),
        });
    };

    const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        localStorage.setItem('companionPetPosition', JSON.stringify(position));
        if (!drag.moved) {
            setSpeech(null);
            setMenuType(current => current === 'none' ? 'main' : 'none');
        }
    };

    if (shouldSkip) return null;

    return (
        <aside
            className={styles.container}
            style={{ right: position.right, bottom: position.bottom }}
            aria-label="伴侣宠物"
        >
            {chatOpen && (
                <section className={styles.panel} aria-label={`与 ${pet?.name ?? '伴侣'} 对话`}>
                    <header className={styles.panelHeader}>
                        <strong>与 {pet?.name ?? '伴侣'} 对话</strong>
                        <button type="button" onClick={() => setChatOpen(false)} aria-label="关闭对话">×</button>
                    </header>
                    <div className={styles.chips}>
                        {['帮我查一下备忘', '今天有什么提醒', '帮我写一段话'].map(prompt => (
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
                <section className={styles.menu} aria-label="伴侣菜单">
                    {menuType !== 'main' && (
                        <button type="button" onClick={() => setMenuType('main')}>← 返回</button>
                    )}
                    {menuType === 'main' && (
                        <>
                            <button type="button" onClick={() => { setChatOpen(true); setMenuType('none'); }}>💬 对话</button>
                            <button type="button" onClick={() => setMenuType('actions')}>🐾 动作</button>
                            <button type="button" onClick={() => setMenuType('appearance')}>🎨 外观</button>
                            <button type="button" onClick={() => setMenuType('rename')}>✏️ 改名</button>
                        </>
                    )}
                    {menuType === 'actions' && (
                        <>
                            {(['idle', 'walk', 'crawl'] as const).map(action => (
                                <button
                                    key={action}
                                    type="button"
                                    onClick={() => { playAction(action); setMenuType('none'); }}
                                >
                                    {action === 'idle' ? '坐下' : action === 'walk' ? '走动' : '爬动'}
                                </button>
                            ))}
                        </>
                    )}
                    {menuType === 'appearance' && PET_ASSETS.map(asset => (
                        <button key={asset.id} type="button" onClick={() => void chooseAppearance(asset.id)}>
                            {asset.emoji} {asset.name}{pet?.assetId === asset.id ? ' ✓' : ''}
                        </button>
                    ))}
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
                            />
                            <button type="button" onClick={() => void submitRename()}>确定</button>
                        </div>
                    )}
                </section>
            )}

            <button
                type="button"
                className={styles.petButton}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { dragRef.current = null; }}
                aria-label={loading ? '正在加载伴侣宠物' : `打开 ${pet?.name ?? '伴侣'} 菜单`}
            >
                {loading || !pet ? (
                    <span className={styles.loading}>🐾</span>
                ) : (
                    <ManifestFrameRenderer
                        assetId={pet.assetId ?? 'kitty'}
                        action={frameAction}
                        className={styles.frames}
                        onError={error => console.error('Pet frame asset failed', error)}
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
