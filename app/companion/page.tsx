'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getAttachment,
    uploadAttachment,
    type Attachment,
} from '@/lib/api/attachments';
import { streamChat } from '@/lib/api/chat';
import { apiUrl } from '@/lib/api/client';
import {
    createConversation,
    listConversations,
    listMessages,
    type ChatMessage,
    type Conversation,
} from '@/lib/api/conversations';
import { PET_ASSETS } from '@/app/components/FloatingPet/petConfig';
import { usePet } from '@/app/components/FloatingPet/usePet';
import Lightbox, { type LightboxImage } from './Lightbox';
import MessageBody from './MessageBody';
import styles from './page.module.css';
import { useImeGuard } from '@/lib/imeGuard';

/** 同一天的消息归在一条日期分隔线下，而不是每条都挂一个时间戳。 */
function dayKey(iso: string): string {
    return new Date(iso).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
    });
}

const MAX_PENDING = 8;

function isImage(attachment: Attachment): boolean {
    return attachment.contentType.startsWith('image/');
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 从消息 metadata 里取附件 id。历史消息只存了 id，详情要另外拉。 */
function attachmentIdsOf(message: ChatMessage): string[] {
    const raw = (message.metadata as Record<string, unknown> | undefined)?.attachmentIds;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

function relativeDay(iso: string): string {
    const date = new Date(iso);
    const days = Math.floor(
        (new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0))
        / 86_400_000,
    );
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 一行消息：头像 + 内容。
 *
 * `avatar` 传 null 表示这一行不占头像位（附件行），传 false 表示占位但不显示
 * ——一段连续发言里只有最后一条挂头像，其余保留空位让气泡对齐。
 */
function Row({
    fromUser,
    avatar,
    petEmoji,
    children,
}: {
    fromUser: boolean;
    avatar: boolean | null;
    petEmoji: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`${styles.row} ${fromUser ? styles.rowUser : ''}`}>
            {avatar === null ? null : avatar ? (
                <span className={styles.avatar} aria-hidden="true">
                    {fromUser ? '💌' : petEmoji}
                </span>
            ) : (
                <span className={styles.avatarSpacer} aria-hidden="true" />
            )}
            {avatar === null && <span className={styles.avatarSpacer} aria-hidden="true" />}
            {children}
        </div>
    );
}

/** 消息里的一个附件。图片做成拍立得可点开放大，其它类型给一张可下载的卡片。 */
function AttachmentView({
    attachment,
    onZoom,
}: {
    attachment: Attachment;
    onZoom: (image: LightboxImage) => void;
}) {
    const href = apiUrl(attachment.downloadUrl);
    if (isImage(attachment)) {
        return (
            <button
                type="button"
                className={styles.attachedImage}
                onClick={() => onZoom({
                    // 放大看原图，不是缩略图
                    src: href,
                    alt: attachment.filename,
                    downloadUrl: href,
                })}
                aria-label={`查看 ${attachment.filename}`}
            >
                {/* next/image 需要预先声明远端域名，而附件是运行时才知道的用户上传，
                    这里用原生 img 更直接。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={apiUrl(attachment.thumbnailUrl || attachment.downloadUrl)}
                    alt={attachment.filename}
                />
            </button>
        );
    }
    return (
        <a href={href} target="_blank" rel="noreferrer" className={styles.attachedFile}>
            <span aria-hidden="true">📄</span>
            <span className={styles.attachedName}>{attachment.filename}</span>
            <small>{humanSize(attachment.size)}</small>
        </a>
    );
}

export default function CompanionPage() {
    /** 回车发送在输入法下的护栏，见 lib/imeGuard.ts。 */
    const ime = useImeGuard();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    /** 正在流式抵达的回复。落库前先显示在末尾。 */
    const [streamingReply, setStreamingReply] = useState('');
    /** 本轮里已生成、但消息还没落库的文件 */
    const [streamingAttachmentIds, setStreamingAttachmentIds] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    /** 待发送的附件 */
    const [pending, setPending] = useState<Attachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);
    /** 历史消息里的附件详情，按 id 缓存——同一张图在多条消息里只拉一次 */
    const [attachmentCache, setAttachmentCache] = useState<Record<string, Attachment>>({});
    const [zoomed, setZoomed] = useState<LightboxImage | null>(null);
    const { pet } = usePet();
    const petName = pet?.name ?? '它';
    const petEmoji =
        PET_ASSETS.find(asset => asset.id === pet?.assetId)?.emoji ?? '🐾';
    const threadRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const refreshList = useCallback(async () => {
        try {
            return await listConversations();
        } catch {
            setError('对话列表加载失败');
            return [];
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const list = await refreshList();
            if (cancelled) return;
            setConversations(list);
            setActiveId(current => current ?? list[0]?.id ?? null);
            setLoaded(true);
        })();
        return () => { cancelled = true; };
    }, [refreshList]);

    useEffect(() => {
        if (!activeId) {
            setMessages([]);
            return;
        }
        let cancelled = false;
        void listMessages(activeId)
            .then(items => { if (!cancelled) setMessages(items); })
            .catch(() => { if (!cancelled) setError('这段对话读不出来了'); });
        return () => { cancelled = true; };
    }, [activeId]);

    // 补齐消息与本轮流式产物引用到的附件详情。两边都只有 id，
    // 要显示缩略图或文件名得再拉一次。
    useEffect(() => {
        const missing = [
            ...new Set([
                ...messages.flatMap(attachmentIdsOf),
                ...streamingAttachmentIds,
            ]),
        ].filter(id => !attachmentCache[id]);
        if (missing.length === 0) return;
        let cancelled = false;
        void Promise.all(
            missing.map(id => getAttachment(id).catch(() => null)),
        ).then(items => {
            if (cancelled) return;
            const resolved = items.filter((item): item is Attachment => item !== null);
            if (resolved.length === 0) return;
            setAttachmentCache(current => ({
                ...current,
                ...Object.fromEntries(resolved.map(item => [item.id, item])),
            }));
        });
        return () => { cancelled = true; };
    }, [messages, streamingAttachmentIds, attachmentCache]);

    // 新消息到达时贴到底部。用 scrollTop 而不是 scrollIntoView——
    // 后者会连带滚动整个页面。
    useEffect(() => {
        const thread = threadRef.current;
        if (thread) thread.scrollTop = thread.scrollHeight;
    }, [messages, streamingReply]);

    const addFiles = useCallback(async (files: FileList | File[] | null) => {
        const incoming = Array.from(files ?? []);
        if (incoming.length === 0 || uploading) return;
        setUploading(true);
        setError(null);
        try {
            const room = Math.max(0, MAX_PENDING - pending.length);
            if (incoming.length > room) {
                setError(`一次最多带 ${MAX_PENDING} 个附件，多的没有加进来`);
            }
            const uploaded = await Promise.all(
                incoming.slice(0, room).map(uploadAttachment),
            );
            setPending(current => [...current, ...uploaded]);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '文件没能传上去');
        } finally {
            setUploading(false);
        }
    }, [pending.length, uploading]);

    const send = async () => {
        const text = draft.trim();
        // 只发附件不打字也应该成立——分享一张图本身就是一句话。
        const message = text || (pending.length ? '看看这个' : '');
        if (!message || sending || uploading) return;
        setDraft('');
        setSending(true);
        setError(null);
        setStreamingReply('');
        setStreamingAttachmentIds([]);

        const attachments = pending;
        setPending([]);
        // 乐观插入用户这条：等服务端回声会让输入框清空后出现一段空白。
        // 附件先塞进缓存，这样乐观那条也能立刻显示缩略图。
        if (attachments.length) {
            setAttachmentCache(current => ({
                ...current,
                ...Object.fromEntries(attachments.map(item => [item.id, item])),
            }));
        }
        const optimistic: ChatMessage = {
            id: `pending-${Date.now()}`,
            createdAt: new Date().toISOString(),
            conversationId: activeId ?? '',
            role: 'user',
            content: message,
            metadata: { attachmentIds: attachments.map(item => item.id) },
        };
        setMessages(current => [...current, optimistic]);

        let reply = '';
        let landedIn = activeId;
        try {
            await streamChat({
                conversationId: activeId,
                message,
                attachmentIds: attachments.map(item => item.id),
            }, event => {
                if (event.type === 'text.delta') {
                    reply += event.delta;
                    setStreamingReply(reply);
                } else if (event.type === 'attachment.ready') {
                    // 生成的文件先挂到流式那条上，不用等整轮结束才看得见。
                    setStreamingAttachmentIds(current => [...current, event.attachmentId]);
                } else if (event.type === 'message.completed') {
                    landedIn = event.conversationId;
                }
            });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '没能把话传过去');
        } finally {
            setSending(false);
            setStreamingReply('');
            setStreamingAttachmentIds([]);
            // 以服务端为准重取一次：流里拼出来的文本没有 id 和落库时间，
            // 直接留在本地会和刷新后的内容对不上。
            if (landedIn) {
                setActiveId(landedIn);
                try {
                    setMessages(await listMessages(landedIn));
                } catch {
                    // 重取失败就保留本地这份，至少不会白打一遍字
                }
            }
            setConversations(await refreshList());
        }
    };

    const startNew = async () => {
        try {
            const created = await createConversation();
            setConversations(current => [created, ...current]);
            setActiveId(created.id);
            setMessages([]);
        } catch {
            setError('新的一篇没能建起来');
        }
    };

    let lastDay = '';
    const view = activeId ? 'thread' : 'list';

    return (
        <div className={styles.page} data-view={view}>
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <p className={styles.eyebrow}>Our Letters</p>
                    <h1 className={styles.title}>
                        对话<span className={styles.titleOutline}>本</span>
                    </h1>
                    <button
                        type="button"
                        className={styles.newButton}
                        onClick={() => void startNew()}
                    >
                        ✎ 写新的一篇
                    </button>
                </div>
                <div className={styles.list}>
                    {loaded && conversations.length === 0 && (
                        <p className={styles.empty}>
                            还没有聊过天。
                            <br />
                            从右下角戳一下它，或者直接在这里说点什么。
                        </p>
                    )}
                    {conversations.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.listItem}
                            aria-current={item.id === activeId}
                            onClick={() => setActiveId(item.id)}
                        >
                            <span className={styles.listPreview}>
                                {item.title || item.preview || '（还没说什么）'}
                            </span>
                            <span className={styles.listMeta}>
                                {relativeDay(item.updatedAt ?? item.createdAt)}
                                {item.messageCount ? ` · ${item.messageCount} 条` : ''}
                            </span>
                        </button>
                    ))}
                </div>
            </aside>

            <main className={styles.main}>
                <button
                    type="button"
                    className={styles.mobileBack}
                    onClick={() => setActiveId(null)}
                >
                    ‹ 所有对话
                </button>

                <div className={styles.thread} ref={threadRef}>
                    {messages.length === 0 && !streamingReply && (
                        <p className={styles.empty}>
                            说点什么吧，
                            <br />
                            {petName}一直在。
                        </p>
                    )}
                    {messages.map((message, index) => {
                        const day = dayKey(message.createdAt);
                        const divider = day === lastDay ? null : day;
                        lastDay = day;
                        const attached = attachmentIdsOf(message)
                            .map(id => attachmentCache[id])
                            .filter(Boolean);
                        const fromUser = message.role === 'user';
                        // 头像只在一段连续发言的最后一条出现，避免一排重复的圆点
                        const isLastOfRun = messages[index + 1]?.role !== message.role;
                        return (
                            <div key={message.id}>
                                {divider && (
                                    <div className={styles.dayDivider}>
                                        <span>{divider}</span>
                                    </div>
                                )}
                                {attached.length > 0 && (
                                    <Row fromUser={fromUser} avatar={null} petEmoji={petEmoji}>
                                        <div className={styles.attachedRow}>
                                            {attached.map(item => (
                                                <AttachmentView
                                                    key={item.id}
                                                    attachment={item}
                                                    onZoom={setZoomed}
                                                />
                                            ))}
                                        </div>
                                    </Row>
                                )}
                                {message.content && (
                                    <Row
                                        fromUser={fromUser}
                                        avatar={isLastOfRun}
                                        petEmoji={petEmoji}
                                    >
                                        <div
                                            className={`${styles.bubble} ${
                                                fromUser ? styles.fromUser : styles.fromPet
                                            }`}
                                        >
                                            <MessageBody
                                                content={message.content}
                                                onZoom={setZoomed}
                                            />
                                        </div>
                                    </Row>
                                )}
                            </div>
                        );
                    })}
                    {streamingAttachmentIds.length > 0 && (
                        <Row fromUser={false} avatar={null} petEmoji={petEmoji}>
                            <div className={styles.attachedRow}>
                                {streamingAttachmentIds
                                    .map(id => attachmentCache[id])
                                    .filter(Boolean)
                                    .map(item => (
                                        <AttachmentView
                                            key={item.id}
                                            attachment={item}
                                            onZoom={setZoomed}
                                        />
                                    ))}
                            </div>
                        </Row>
                    )}
                    {streamingReply && (
                        <Row fromUser={false} avatar petEmoji={petEmoji}>
                            <div
                                className={`${styles.bubble} ${styles.fromPet} ${styles.streaming}`}
                            >
                                <MessageBody content={streamingReply} onZoom={setZoomed} />
                            </div>
                        </Row>
                    )}
                </div>

                {error && <p className={styles.hint}>{error}</p>}

                {/* 声明为障碍物，宠物不会站到输入框上（platform/environment.ts）。 */}
                <div
                    className={`${styles.composerWrap} ${dragging ? styles.dropping : ''}`}
                    data-pet-obstacle
                    onDragOver={event => {
                        // 只认真正带文件的拖拽，别把选中文字的拖动也当成上传。
                        if (!event.dataTransfer.types.includes('Files')) return;
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={event => {
                        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                        setDragging(false);
                    }}
                    onDrop={event => {
                        if (!event.dataTransfer.types.includes('Files')) return;
                        event.preventDefault();
                        setDragging(false);
                        void addFiles(event.dataTransfer.files);
                    }}
                >
                    {pending.length > 0 && (
                        <div className={styles.pendingRow}>
                            {pending.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={styles.pendingChip}
                                    title="移除"
                                    onClick={() => setPending(current =>
                                        current.filter(candidate => candidate.id !== item.id))}
                                >
                                    {isImage(item) ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={apiUrl(item.thumbnailUrl || item.downloadUrl)} alt="" />
                                    ) : (
                                        <span aria-hidden="true">📄</span>
                                    )}
                                    <span className={styles.pendingName}>{item.filename}</span>
                                    <span aria-hidden="true">×</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className={styles.composer}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            hidden
                            onChange={event => {
                                void addFiles(event.target.files);
                                event.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            className={styles.attachButton}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || pending.length >= MAX_PENDING}
                            aria-label="添加图片或文件"
                            title="添加图片或文件"
                        >
                            {uploading ? '⏳' : '＋'}
                        </button>
                        <textarea
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            onPaste={event => {
                                // 截图直接粘贴是最常用的一种「上传」，不能只留文件选择器。
                                const files = Array.from(event.clipboardData.files);
                                if (files.length === 0) return;
                                event.preventDefault();
                                void addFiles(files);
                            }}
                            {...ime.handlers}
                            onKeyDown={event => {
                                // Enter 发送，Shift+Enter 换行——这里会写长句子，
                                // 不能像即时通讯那样只允许单行。
                                // 输入法组词时的那一下回车是上屏，不算发送
                                // （见 lib/imeGuard.ts）。
                                if (event.key === 'Enter' && !event.shiftKey
                                    && !ime.isComposing(event)) {
                                    event.preventDefault();
                                    void send();
                                }
                            }}
                            placeholder={dragging ? '松手就带上它' : '想说点什么…可以拖进来或粘贴图片'}
                            aria-label="对话内容"
                            rows={1}
                        />
                        <button
                            type="button"
                            onClick={() => void send()}
                            disabled={sending || uploading}
                        >
                            {sending ? '…' : '说'}
                        </button>
                    </div>
                </div>
            </main>

            <Lightbox image={zoomed} onClose={() => setZoomed(null)} />
        </div>
    );
}
