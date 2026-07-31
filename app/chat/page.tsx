'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    getAttachment,
    uploadAttachment,
    type Attachment,
} from '@/lib/api/attachments';
import {
    fetchThread,
    markChatRead,
    sendDirectMessage,
    type ChatThread,
    type DirectMessage,
    type PetInterjection,
} from '@/lib/api/chatDirect';
import { apiUrl, ApiError } from '@/lib/api/client';
import { subscribeServerEvent } from '@/lib/api/events';
import { PET_ASSETS } from '@/app/components/FloatingPet/petConfig';
import { usePet } from '@/app/components/FloatingPet/usePet';
import Lightbox, { type LightboxImage } from '@/app/companion/Lightbox';
import styles from './page.module.css';

/**
 * 聊天页。
 *
 * **没有已读回执** —— 调查里 54% 的人认为它是关系里的压力来源。这里由宠物替
 * 「未读」这个状态说人话（计划文档 §3.1）。宠物的话在视觉上与真人消息明确
 * 区分：居中、虚线框、带「宠物」标注 —— 即使它说错，也是它说错，不是你说错。
 *
 * 这条流里**不会**出现「有新消息哦」那类催促：你人都在这一页了，那句话已经
 * 完成使命，留下来只会在以后回看时把真正说过的话冲淡。它由浮窗宠物的气泡当场
 * 说完就散，服务端也照常记账（递减节奏要数次数）——见 direct_messages
 * 的 THREAD_HIDDEN_KINDS。这里能看到的只有代答那类：说给在等的另一个人听、
 * 解释了对话里那段空白的话。
 */

const MAX_PENDING = 8;

function isImage(attachment: Attachment): boolean {
    return attachment.contentType.startsWith('image/');
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dayKey(iso: string): string {
    const date = new Date(iso);
    const days = Math.floor(
        (new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0))
        / 86_400_000,
    );
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

/** 把消息与宠物插话按时间合成一条流。 */
type StreamItem =
    | { kind: 'message'; at: number; message: DirectMessage }
    | { kind: 'pet'; at: number; interjection: PetInterjection };

function buildStream(thread: ChatThread | null): StreamItem[] {
    if (!thread) return [];
    const items: StreamItem[] = [
        ...thread.messages.map(message => ({
            kind: 'message' as const,
            at: new Date(message.createdAt).getTime(),
            message,
        })),
        ...thread.interjections.map(interjection => ({
            kind: 'pet' as const,
            at: new Date(interjection.createdAt).getTime(),
            interjection,
        })),
    ];
    return items.sort((a, b) => a.at - b.at);
}

export default function ChatPage() {
    const [thread, setThread] = useState<ChatThread | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [pending, setPending] = useState<Attachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attachmentCache, setAttachmentCache] = useState<Record<string, Attachment>>({});
    const [zoomed, setZoomed] = useState<LightboxImage | null>(null);
    const threadRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { pet } = usePet();

    const petEmoji = PET_ASSETS.find(asset => asset.id === pet?.assetId)?.emoji ?? '🐾';
    const petName = pet?.name ?? '它';

    const load = useCallback(async () => {
        try {
            const data = await fetchThread();
            setThread(data);
            setBlocked(null);
            return data;
        } catch (reason) {
            // 409 是「还没有第二个人」——这是配置问题，要明确告诉用户，
            // 不能显示成一个空对话（计划文档 §0.3）。
            if (reason instanceof ApiError && reason.status === 409) {
                setBlocked(reason.message);
            } else {
                setError('聊天记录读不出来');
            }
            return null;
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // 打开这一页就算看到了 —— 宠物的唠叨据此立刻停。
    useEffect(() => {
        if (!thread || thread.unreadCount === 0) return;
        void markChatRead().then(() => void load());
    }, [thread, load]);

    // 对方发消息时实时刷新。SSE 不带正文，只是个信号。
    useEffect(() => {
        return subscribeServerEvent('chat.message', () => {
            void load();
        });
    }, [load]);

    // 补齐附件详情。消息里只有 id。
    useEffect(() => {
        const missing = [
            ...new Set((thread?.messages ?? []).flatMap(item => item.attachmentIds)),
        ].filter(id => !attachmentCache[id]);
        if (missing.length === 0) return;
        let cancelled = false;
        void Promise.all(missing.map(id => getAttachment(id).catch(() => null)))
            .then(items => {
                if (cancelled) return;
                const resolved = items.filter((item): item is Attachment => item !== null);
                if (!resolved.length) return;
                setAttachmentCache(current => ({
                    ...current,
                    ...Object.fromEntries(resolved.map(item => [item.id, item])),
                }));
            });
        return () => { cancelled = true; };
    }, [thread, attachmentCache]);

    const stream = useMemo(() => buildStream(thread), [thread]);

    useEffect(() => {
        const node = threadRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [stream]);

    const addFiles = useCallback(async (files: FileList | File[] | null) => {
        const incoming = Array.from(files ?? []);
        if (!incoming.length || uploading) return;
        setUploading(true);
        setError(null);
        try {
            const room = Math.max(0, MAX_PENDING - pending.length);
            if (incoming.length > room) setError(`一次最多带 ${MAX_PENDING} 个附件`);
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
        const body = draft.trim();
        if ((!body && !pending.length) || sending || uploading) return;
        setDraft('');
        setSending(true);
        setError(null);
        const attachments = pending;
        setPending([]);
        if (attachments.length) {
            setAttachmentCache(current => ({
                ...current,
                ...Object.fromEntries(attachments.map(item => [item.id, item])),
            }));
        }
        try {
            await sendDirectMessage(body, attachments.map(item => item.id));
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '没发出去');
            setDraft(body);
            setPending(attachments);
        } finally {
            setSending(false);
        }
    };

    const renderAttachments = (ids: string[]) => {
        const resolved = ids.map(id => attachmentCache[id]).filter(Boolean);
        if (!resolved.length) return null;
        return resolved.map(item =>
            isImage(item) ? (
                <button
                    key={item.id}
                    type="button"
                    className={styles.attachedImage}
                    onClick={() => setZoomed({
                        src: apiUrl(item.downloadUrl),
                        alt: item.filename,
                        downloadUrl: apiUrl(item.downloadUrl),
                    })}
                    aria-label={`查看 ${item.filename}`}
                >
                    {/* 附件是运行时才知道的用户上传，next/image 声明不了域名 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={apiUrl(item.thumbnailUrl || item.downloadUrl)}
                        alt={item.filename}
                    />
                </button>
            ) : (
                <a
                    key={item.id}
                    href={apiUrl(item.downloadUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.attachedFile}
                >
                    <span aria-hidden="true">📄</span>
                    <span className={styles.attachedName}>{item.filename}</span>
                    <small>{humanSize(item.size)}</small>
                </a>
            ),
        );
    };

    if (blocked) {
        return (
            <div className={styles.page}>
                <div className={styles.blocked}>
                    {blocked}
                    <br />
                    <br />
                    开发环境可以跑 <code>python -m app.cli seed-users</code> 补齐账号。
                </div>
            </div>
        );
    }

    let lastDay = '';

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <span className={styles.avatar} aria-hidden="true">💌</span>
                <div className={styles.headerText}>
                    <h1 className={styles.headerName}>
                        {thread?.partner.displayName ?? '对方'}
                    </h1>
                    {/* 刻意不显示「已读/未读」——那是压力来源。 */}
                    <p className={styles.headerHint}>
                        {petName}会在这儿帮着传话
                    </p>
                </div>
            </header>

            <div className={styles.thread} ref={threadRef}>
                {stream.length === 0 && (
                    <p className={styles.empty}>
                        还没聊过。
                        <br />
                        说点什么吧。
                    </p>
                )}
                {stream.map(item => {
                    const day = dayKey(
                        item.kind === 'message'
                            ? item.message.createdAt
                            : item.interjection.createdAt,
                    );
                    const divider = day === lastDay ? null : day;
                    lastDay = day;

                    if (item.kind === 'pet') {
                        return (
                            <div key={`pet-${item.interjection.id}`}>
                                {divider && <div className={styles.dayDivider}>{divider}</div>}
                                {/* 宠物的话：一眼看出不是人在说（§3.2） */}
                                <div className={styles.interjection}>
                                    <span className={styles.interjectionIcon} aria-hidden="true">
                                        {petEmoji}
                                    </span>
                                    <div className={styles.interjectionBody}>
                                        <span className={styles.interjectionTag}>
                                            {petName}说
                                        </span>
                                        {item.interjection.body}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    const mine = item.message.senderId !== thread?.partner.id;
                    return (
                        <div key={item.message.id}>
                            {divider && <div className={styles.dayDivider}>{divider}</div>}
                            {item.message.attachmentIds.length > 0 && (
                                <div className={`${styles.row} ${mine ? styles.rowMine : ''}`}>
                                    <div className={styles.attachedRow}>
                                        {renderAttachments(item.message.attachmentIds)}
                                    </div>
                                </div>
                            )}
                            {item.message.body && (
                                <div className={`${styles.row} ${mine ? styles.rowMine : ''}`}>
                                    <div
                                        className={`${styles.bubble} ${
                                            mine ? styles.fromMe : styles.fromPartner
                                        }`}
                                    >
                                        {item.message.body}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {error && <p className={styles.hint}>{error}</p>}

            {/* 声明为障碍物，宠物不会站到输入框上 */}
            <div
                className={`${styles.composerWrap} ${dragging ? styles.dropping : ''}`}
                data-pet-obstacle
                onDragOver={event => {
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
                                    <img
                                        src={apiUrl(item.thumbnailUrl || item.downloadUrl)}
                                        alt=""
                                    />
                                ) : (
                                    <span aria-hidden="true">📄</span>
                                )}
                                <span className={styles.attachedName}>{item.filename}</span>
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
                    >
                        {uploading ? '⏳' : '＋'}
                    </button>
                    <textarea
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onPaste={event => {
                            const files = Array.from(event.clipboardData.files);
                            if (!files.length) return;
                            event.preventDefault();
                            void addFiles(files);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void send();
                            }
                        }}
                        placeholder={dragging ? '松手就带上它' : '说点什么…'}
                        aria-label="消息内容"
                        rows={1}
                    />
                    <button
                        type="button"
                        className={styles.sendButton}
                        onClick={() => void send()}
                        disabled={sending || uploading}
                    >
                        {sending ? '…' : '发送'}
                    </button>
                </div>
            </div>

            <Lightbox image={zoomed} onClose={() => setZoomed(null)} />
        </div>
    );
}
