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
import LocalFileMentionMenu, { useLocalFileMention } from '@/app/components/LocalFileMentionMenu';
import { Plus, Reply, Smile, X } from 'lucide-react';
import { useImeGuard } from '@/lib/imeGuard';
import VoiceButton from './VoiceButton';
import StickerPanel from './StickerPanel';
import VoiceBubble from './VoiceBubble';
import { saveSticker, type Sticker } from '@/lib/api/stickers';
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

/**
 * 谁都能用的通用叫法。**必须与后端 `chat_assist.GENERIC_MENTIONS` 一致**——
 * 这边判断「要不要显示正在想」，那边判断「要不要真的去想」，两边分叉的结果是
 * 转圈转到超时，或者答案凭空冒出来。
 */
const GENERIC_MENTIONS = ['@宠物', '@pet'];

/**
 * 这条消息有没有叫宠物。与后端 `mentions_pet` 同一套规则。
 *
 * 前端也判一次是为了**立刻**给出反馈：后端要十几秒才回，这段时间里用户需要
 * 知道「它收到了」。判错的代价是对称的小事——多转一会儿圈，或者少转一会儿。
 */
function mentionsPet(body: string, petName: string): boolean {
    const lowered = body.toLowerCase();
    if (GENERIC_MENTIONS.some(alias => lowered.includes(alias))) return true;
    if (!petName) return false;
    const escaped = petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@\\s*${escaped}`, 'i').test(body);
}

/**
 * 等宠物回话的上限。比后端 ASSIST 角色的 50s 超时再宽一点——那边超时会静默
 * 放弃，这边得比它晚放手，否则会出现「圈停了、答案随后才到」。
 */
const ASSIST_WAIT_MS = 70_000;

function isImage(attachment: Attachment): boolean {
    return attachment.contentType.startsWith('image/');
}

/**
 * 这是不是一条语音。
 *
 * 也认文件名后缀：Tauri 那条上传路径不猜 MIME，一律申报
 * `application/octet-stream`（见后端 complete_upload 的注释），只看
 * contentType 的话桌面版发出去的语音会被当成普通文件。
 */
function isVoice(attachment: Attachment): boolean {
    return attachment.contentType.startsWith('audio/')
        || /\.(webm|m4a|mp3|ogg|wav)$/i.test(attachment.filename);
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
    /** 正在引用的那条。发送后清空。 */
    const [quoting, setQuoting] = useState<DirectMessage | null>(null);
    const [stickersOpen, setStickersOpen] = useState(false);
    /**
     * 正在等宠物回话的那条消息。
     *
     * 记的是 messageId 而不是一个布尔量：插话落库时带着 `messageId`，所以
     * 「这一次的回答到了没有」可以精确判断，不用靠时间猜。`timedOut` 是等
     * 太久之后的降级——**不能就这么让圈消失**，那等于把「它收到了吗」这个
     * 疑问原样还给用户，而这正是要修的东西。
     */
    const [awaiting, setAwaiting] = useState<
        { messageId: string; timedOut: boolean } | null
    >(null);
    const threadRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    /** addFiles 定义在下面，mention hook 在它之前就要拿到回调。 */
    const addFilesRef = useRef<((files: File[]) => void) | null>(null);
    const { pet } = usePet();
    /** 回车发送在输入法下的护栏，见 lib/imeGuard.ts。 */
    const ime = useImeGuard();

    /** 按 id 找消息，渲染引用块要用。 */
    const messageById = useMemo(
        () => new Map((thread?.messages ?? []).map(item => [item.id, item])),
        [thread],
    );

    /** 跳回被引用的那条并高亮一下。找不到（已被删）就什么都不做。 */
    const jumpTo = useCallback((id: string) => {
        const node = document.getElementById(`msg-${id}`);
        if (!node) return;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.dataset.flash = 'true';
        setTimeout(() => { delete node.dataset.flash; }, 1400);
    }, []);

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

    /** 发一个表情。**带 sticker 标记**——不标的话对方那边会当成普通图片，
        套上气泡、按缩略图渲染，GIF 也就不动了。 */
    const sendSticker = useCallback((sticker: Sticker) => {
        setStickersOpen(false);
        void sendDirectMessage('', [sticker.attachmentId], quoting?.id ?? null, true)
            .then(() => { setQuoting(null); return load(); })
            .catch(() => setError('表情没发出去'));
    }, [quoting, load]);

    /** 把聊天里的一张图存成自己的表情。 */
    const keepAsSticker = useCallback((attachmentId: string) => {
        void saveSticker(attachmentId)
            .then(() => setError('已存为表情'))
            .catch(reason => setError(
                reason instanceof Error ? reason.message : '存不进去'));
    }, []);


    /**
     * 「看到了」要有人在场的证据，光是页面开着不算。
     *
     * 原来的判断是「这一页挂上了且有未读 → 全标已读」。问题在于消息是从 SSE
     * 实时进来的：把这一页开着走开，之后每来一条都会在无人的情况下立刻变成
     * 已读——对方看到的是「已读不回」，宠物的催促也永远赶不上。**电脑开着人
     * 不在是每天都会发生的事**，不能把它当成看过了。
     *
     * 所以要三件事同时成立：页面可见、窗口有焦点、最近有过真人输入。人回来
     * 时任何一次按键或点击都会立刻补上这一步，所以感觉不到延迟。
     */
    const PRESENCE_WINDOW_MS = 120_000;
    const lastInputRef = useRef(Date.now());
    useEffect(() => {
        const touch = () => { lastInputRef.current = Date.now(); };
        const events = ['pointerdown', 'keydown', 'wheel', 'focus'] as const;
        events.forEach(name => window.addEventListener(name, touch, { passive: true }));
        return () => events.forEach(name => window.removeEventListener(name, touch));
    }, []);

    useEffect(() => {
        if (!thread || thread.unreadCount === 0) return;
        const present = () =>
            document.visibilityState === 'visible'
            && document.hasFocus()
            && Date.now() - lastInputRef.current < PRESENCE_WINDOW_MS;

        const settle = () => {
            if (!present()) return;
            void markChatRead().then(() => void load());
        };
        settle();
        // 人回来的那一下（切回标签页、点一下、按个键）立刻补标已读。
        const events = ['pointerdown', 'keydown', 'focus', 'visibilitychange'] as const;
        events.forEach(name => window.addEventListener(name, settle, { passive: true }));
        return () => events.forEach(name => window.removeEventListener(name, settle));
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

    // 「正在想」那块不在 stream 里，但它出现/消失同样会改变内容高度——
    // 不跟着滚的话，它正好落在可视区外面，等于没做。
    useEffect(() => {
        const node = threadRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [stream, awaiting]);

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

    addFilesRef.current = files => void addFiles(files);

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
            const sent = await sendDirectMessage(
                body, attachments.map(item => item.id), quoting?.id ?? null,
            );
            setQuoting(null);
            // 叫了宠物就立刻挂上「正在想」。后端是排队后台答的，十几秒里
            // 屏幕上不该什么都没有——那正是「我都不知道他收没收到」的来源。
            if (mentionsPet(body, petName)) {
                setAwaiting({ messageId: sent.id, timedOut: false });
            }
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '没发出去');
            setDraft(body);
            setPending(attachments);
            // 引用也要还回去：不还的话用户得重新找一遍那条消息。
        } finally {
            setSending(false);
        }
    };

    /** 这一次的回答到了没有。按 messageId 精确匹配，不靠时间猜。 */
    const answered = Boolean(
        awaiting
        && thread?.interjections.some(item => item.messageId === awaiting.messageId),
    );

    /**
     * **对方叫他自己宠物时，这边也要显示「正在想」。**
     *
     * 上面那个 `setAwaiting` 只在「我发消息」这条路径上触发，而且拿的是我自己
     * 宠物的名字。于是 A 打 `@饼干`，B 的客户端拿「Kitty」去匹配——匹配不上，
     * B 那边就是聊天框静默十几秒，然后凭空冒出一句回答。
     *
     * 病根和署名是同一个：前端用本地那只宠物去解释一条本该自带归属的消息。
     * 对方宠物的名字现在随 thread.partner 一起来（见后端 PartnerRead）。
     */
    useEffect(() => {
        if (awaiting || !thread) return;
        const partnerPet = thread.partner.petName;
        if (!partnerPet) return;
        const replied = new Set(
            thread.interjections.map(item => item.messageId).filter(Boolean),
        );
        const waiting = [...thread.messages].reverse().find(message =>
            message.senderId === thread.partner.id
            && mentionsPet(message.body, partnerPet)
            && !replied.has(message.id));
        if (waiting) setAwaiting({ messageId: waiting.id, timedOut: false });
    }, [awaiting, thread]);

    // 等太久就换个说法，而不是让圈悄悄消失。后端超时是静默放弃的，
    // 不标出来的话用户会一直等一句永远不来的话。
    useEffect(() => {
        if (!awaiting || awaiting.timedOut || answered) return;
        const timer = setTimeout(
            () => setAwaiting(current =>
                current ? { ...current, timedOut: true } : null),
            ASSIST_WAIT_MS,
        );
        return () => clearTimeout(timer);
    }, [awaiting, answered]);

    /**
     * `@` 的第二类候选：这台电脑上的文件（只在桌面版，且只在授权目录里）。
     *
     * 选中之后走的是**附件**这条路，不是往消息里插一个路径让宠物自己去读
     * ——私聊里的宠物拿不到本地文件工具，那一档带着联网搜索，
     * 不该和本地文件权限同轮出现（见 backend/app/agents/roles.py）。
     */
    /**
     * **宠物和本机文件在同一个候选列表里。**
     *
     * 原来是两个独立的浮层各画各的：`LocalFileMentionMenu` 先渲染，文件那个
     * 盖在宠物那个上面——打一个 `@` 只看得见文件，宠物被压在底下。而且两套
     * 键盘导航互相不知道对方存在，上下键在两个列表之间跳不过去。
     *
     * 现在合成一个列表：宠物在前（它是最常叫的），文件在后，一套高亮、
     * 一套上下键、一个 Enter。
     */
    const petMentionExtra = useCallback((query: string) => {
        // 名字是用户能随时改的，所以只认当前的宠物名，外加两个通用叫法——
        // 后端 chat_assist.GENERIC_MENTIONS 认的就是这两个，两边必须一致，
        // 否则这里提示能打的东西后端不认。
        const matched = [petName, '宠物', 'pet'].some(alias =>
            alias.toLowerCase().startsWith(query.toLowerCase()));
        if (!matched) return [];
        return [{
            id: 'pet',
            name: petName,
            emoji: petEmoji,
            hint: '就着聊天记录帮个忙',
            onPick: () => applyMentionRef.current?.(),
        }];
    }, [petName, petEmoji]);

    const fileMention = useLocalFileMention(
        useCallback((file: File) => addFilesRef.current?.([file]), []),
        useCallback((message: string) => setError(message), []),
        petMentionExtra,
    );

    /** 选中候选：把光标前那截 `@半截名字` 换成完整的 `@名字 `。 */
    const applyMentionRef = useRef<(() => void) | null>(null);
    const applyMention = useCallback(() => {
        const element = composerRef.current;
        if (!element) return;
        const caret = element.selectionStart;
        const start = element.value.slice(0, caret).lastIndexOf('@');
        if (start < 0) return;
        const inserted = `@${petName} `;
        setDraft(element.value.slice(0, start) + inserted + element.value.slice(caret));
        // setDraft 之后 DOM 还是旧值，得等这一帧渲染完再放光标
        requestAnimationFrame(() => {
            element.focus();
            const position = start + inserted.length;
            element.setSelectionRange(position, position);
        });
    }, [petName]);
    applyMentionRef.current = applyMention;

    const renderAttachments = (ids: string[], mine: boolean) => {
        const resolved = ids.map(id => attachmentCache[id]).filter(Boolean);
        if (!resolved.length) return null;
        return resolved.map(item =>
            // 语音条：**不是普通附件那种「点开下载」**。语音要能就地播，
            // 跳出去开个新标签页听一段两秒的话毫无道理。
            isVoice(item) ? (
                <VoiceBubble
                    key={item.id}
                    src={item.downloadUrl}
                    filename={item.filename}
                    mine={mine}
                />
            ) : isImage(item) ? (
                <button
                    key={item.id}
                    type="button"
                    className={styles.attachedImage}
                    // 右键存表情。**桌面上长按不是习惯动作**，右键才是；
                    // 触屏那边浏览器会把长按翻译成 contextmenu，所以一套就够。
                    onContextMenu={event => {
                        event.preventDefault();
                        keepAsSticker(item.id);
                    }}
                    title="右键存为表情"
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
                    href={apiUrl(item.previewUrl || item.downloadUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.attachedFile}
                >
                    <span aria-hidden="true">📄</span>
                    <span className={styles.attachedName}>{item.filename}</span>
                    <small>{item.previewUrl ? `PDF 预览 · ${humanSize(item.size)}` : humanSize(item.size)}</small>
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
                        {petName}会在这儿帮着传话 · 打 @{petName} 可以叫它
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
                        /**
                         * 署**说话的那只**，不是看的人那只。
                         *
                         * 两个人各有一只宠物。以前这里挂的是本地的 `petName`，
                         * 于是 A 打 `@饼干` 得到的回答，在 B 屏幕上署着 B 那只的名字
                         * ——同一句话两个署名。归属由服务端随插话一起给
                         * （见 lib/api/chatDirect.ts 的 speakerName）。
                         *
                         * 旧数据没有归属，回退到中性的「宠物」，不猜。
                         */
                        const speaker = item.interjection.speakerName;
                        const speakerEmoji = item.interjection.speakerAssetId
                            ? PET_ASSETS.find(a => a.id === item.interjection.speakerAssetId)?.emoji
                            : undefined;
                        return (
                            <div key={`pet-${item.interjection.id}`}>
                                {divider && <div className={styles.dayDivider}>{divider}</div>}
                                {/* 宠物的话：一眼看出不是人在说（§3.2） */}
                                <div className={styles.interjection}>
                                    <span className={styles.interjectionIcon} aria-hidden="true">
                                        {speakerEmoji ?? '🐾'}
                                    </span>
                                    <div className={styles.interjectionBody}>
                                        <span className={styles.interjectionTag}>
                                            {speaker ? `${speaker}说` : '宠物说'}
                                        </span>
                                        {item.interjection.body}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    const mine = item.message.senderId !== thread?.partner.id;
                    const quoted = item.message.replyToId
                        ? messageById.get(item.message.replyToId)
                        : undefined;
                    return (
                        <div key={item.message.id} id={`msg-${item.message.id}`}>
                            {divider && <div className={styles.dayDivider}>{divider}</div>}
                            {item.message.attachmentIds.length > 0 && (
                                <div className={`${styles.row} ${mine ? styles.rowMine : ''}`}>
                                    {item.message.sticker ? (
                                        /* 表情不套气泡、不走缩略图。缩略图是静态 webp，
                                           GIF 从那条路出来就是一张定格。 */
                                        <div className={styles.stickerBubble}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={apiUrl(
                                                    `/api/v1/attachments/${item.message.attachmentIds[0]}/content`,
                                                )}
                                                alt="表情"
                                            />
                                        </div>
                                    ) : (
                                        <div className={styles.attachedRow}>
                                            {renderAttachments(item.message.attachmentIds, mine)}
                                        </div>
                                    )}
                                </div>
                            )}
                            {(item.message.body || quoted || item.message.replyToId) && (
                                <div className={`${styles.row} ${mine ? styles.rowMine : ''}`}>
                                    {/* 引用按钮挂在行上，鼠标划过才出现——常驻的话
                                        每条消息旁边都挂个图标，把话本身的分量冲淡了。 */}
                                    <button
                                        type="button"
                                        className={styles.quoteAction}
                                        onClick={() => {
                                            setQuoting(item.message);
                                            composerRef.current?.focus();
                                        }}
                                        aria-label="引用这条"
                                        title="引用这条"
                                    >
                                        <Reply size={14} />
                                    </button>
                                    <div
                                        className={`${styles.bubble} ${
                                            mine ? styles.fromMe : styles.fromPartner
                                        }`}
                                    >
                                        {/* 被引用的原文。**点它跳回原消息**——引用的
                                            价值在于「哪句话」，看不到上下文就只是装饰。 */}
                                        {item.message.replyToId && (
                                            quoted ? (
                                                <button
                                                    type="button"
                                                    className={styles.quotedBlock}
                                                    onClick={() => jumpTo(quoted.id)}
                                                >
                                                    <span className={styles.quotedWho}>
                                                        {quoted.senderId === thread?.partner.id
                                                            ? thread?.partner.displayName
                                                            : '我'}
                                                    </span>
                                                    <span className={styles.quotedText}>
                                                        {quoted.body
                                                            || (quoted.attachmentIds.length
                                                                ? '［附件］' : '')}
                                                    </span>
                                                </button>
                                            ) : (
                                                <div className={styles.quotedBlock}>
                                                    <span className={styles.quotedText}>
                                                        原消息已不在
                                                    </span>
                                                </div>
                                            )
                                        )}
                                        {item.message.body}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* 「它收到了没有」——叫完宠物到它开口之间有十几秒，这段空白
                    以前什么都没有。答案到了这块自然消失（被真的插话顶替）。 */}
                {awaiting && !answered && (
                    <div className={`${styles.interjection} ${styles.thinking}`}>
                        <span className={styles.interjectionIcon} aria-hidden="true">
                            {petEmoji}
                        </span>
                        <div className={styles.interjectionBody} role="status">
                            {awaiting.timedOut ? (
                                `${petName}这次没答上来，再叫一次试试。`
                            ) : (
                                <>
                                    {petName}正在想
                                    <span className={styles.thinkingDots} aria-hidden="true">
                                        <i /><i /><i />
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                )}
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
                <LocalFileMentionMenu controller={fileMention} />

                {stickersOpen && (
                    <StickerPanel
                        onPick={sendSticker}
                        onError={setError}
                        onClose={() => setStickersOpen(false)}
                    />
                )}

                {/* 正在引用谁。**要能取消**——选错了却撤不掉，就只能把话发出去
                    或者刷新页面。 */}
                {quoting && (
                    <div className={styles.quotingBar}>
                        <span className={styles.quotingWho}>
                            回复 {quoting.senderId === thread?.partner.id
                                ? thread?.partner.displayName : '自己'}
                        </span>
                        <span className={styles.quotingText}>
                            {quoting.body || (quoting.attachmentIds.length ? '［附件］' : '')}
                        </span>
                        <button
                            type="button"
                            className={styles.quotingCancel}
                            onClick={() => setQuoting(null)}
                            aria-label="取消引用"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

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
                        <Plus size={18} />
                    </button>
                    <button
                        type="button"
                        className={styles.attachButton}
                        onClick={() => setStickersOpen(value => !value)}
                        aria-label="表情"
                        aria-expanded={stickersOpen}
                    >
                        <Smile size={18} />
                    </button>
                    {/* 按住说话。录完直接当附件发出去，和拖进来一张图同一条路径
                        ——不为语音单开一套上传。 */}
                    <VoiceButton
                        disabled={uploading || sending}
                        onError={setError}
                        onRecorded={clip => {
                            void (async () => {
                                setUploading(true);
                                try {
                                    const attachment = await uploadAttachment(clip.file);
                                    setAttachmentCache(current => ({
                                        ...current, [attachment.id]: attachment,
                                    }));
                                    await sendDirectMessage(
                                        '', [attachment.id], quoting?.id ?? null,
                                    );
                                    setQuoting(null);
                                    await load();
                                } catch (reason) {
                                    setError(reason instanceof Error
                                        ? reason.message : '语音没发出去');
                                } finally {
                                    setUploading(false);
                                }
                            })();
                        }}
                    />
                    <textarea
                        ref={composerRef}
                        value={draft}
                        {...ime.handlers}
                        onChange={event => {
                            setDraft(event.target.value);
                            fileMention.sync(event.target);
                        }}
                        onClick={event => {
                            fileMention.sync(event.currentTarget);
                        }}
                        onBlur={() => fileMention.dismiss()}
                        onPaste={event => {
                            const files = Array.from(event.clipboardData.files);
                            if (!files.length) return;
                            event.preventDefault();
                            void addFiles(files);
                        }}
                        onKeyDown={event => {
                            // **输入法正在组词时，这一下回车是上屏，不是「我说完了」。**
                            // 必须放在所有分支之前：底下的文件候选和 @ 候选也都吃
                            // Enter，拦晚了就变成「按回车选词，结果选中了一个候选项」。
                            if (event.key === 'Enter' && ime.isComposing(event)) return;
                            // 文件候选先挑（上下键 / Enter / Tab / Esc）。
                            // 它返回 true 就说明这个键已经用掉了，不能再往下走。
                            if (fileMention.handleKeyDown(event)) return;
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void send();
                                return;
                            }
                            // 方向键移动光标后 selectionStart 才更新，所以推到下一帧再看
                            if (event.key.startsWith('Arrow') || event.key === 'Backspace') {
                                const element = event.currentTarget;
                                requestAnimationFrame(() => {
                                    fileMention.sync(element);
                                });
                            }
                        }}
                        placeholder={dragging ? '松手就带上它' : `说点什么…（@ 叫${petName}，也能带本机文件）`}
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
