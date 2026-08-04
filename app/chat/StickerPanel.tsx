'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { apiUrl } from '@/lib/api/client';
import { uploadAttachment } from '@/lib/api/attachments';
import {
    deleteSticker,
    listStickers,
    moveStickersToFront,
    saveSticker,
    type Sticker,
} from '@/lib/api/stickers';
import styles from './page.module.css';

/**
 * 表情面板。
 *
 * ## 两个标签，不是两个面板
 *
 * 表情各存各的，但对方存的也能直接发——看到对方发了个好玩的还得自己再存一遍
 * 才能用，那这个功能就白做了。所以「我的 / 对方的」只是同一个网格的两个筛选。
 *
 * ## 「整理」是一个模式，不是一排按钮
 *
 * 平时点表情就是发出去。要删要排序时切进整理模式——那时候点表情变成勾选。
 * 微信也是这么分的：**发送是高频、管理是低频**，把管理按钮常驻在每个表情上
 * 会让高频操作变得容易误触。
 *
 * ## 排序抄「移到最前」而不是拖拽
 *
 * 几百个表情拖拽排序是灾难，而人真正想要的只是把常用的顶上来。
 */
export default function StickerPanel({
    onPick,
    onError,
    onClose,
}: {
    onPick: (sticker: Sticker) => void;
    onError: (message: string) => void;
    onClose: () => void;
}) {
    const [items, setItems] = useState<Sticker[]>([]);
    const [tab, setTab] = useState<'mine' | 'theirs'>('mine');
    const [organizing, setOrganizing] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    const reload = useCallback(() => {
        listStickers()
            .then(setItems)
            .catch(() => onError('表情读不出来'));
    }, [onError]);

    useEffect(() => { reload(); }, [reload]);

    const shown = items.filter(item => (tab === 'mine' ? item.mine : !item.mine));

    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        setBusy(true);
        try {
            for (const file of Array.from(files)) {
                const attachment = await uploadAttachment(file);
                await saveSticker(attachment.id);
            }
            reload();
        } catch (reason) {
            onError(reason instanceof Error ? reason.message : '存不进去');
        } finally {
            setBusy(false);
        }
    };

    const toggle = (id: string) => {
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const removeSelected = async () => {
        setBusy(true);
        try {
            for (const id of selected) await deleteSticker(id);
            setSelected(new Set());
            reload();
        } catch {
            onError('删不掉');
        } finally {
            setBusy(false);
        }
    };

    const promoteSelected = async () => {
        setBusy(true);
        try {
            // 按当前展示顺序传，服务端照这个顺序编号——传 Set 的迭代顺序
            // 会变成「你点选的先后」，那不是用户看到的顺序。
            const ordered = shown.filter(item => selected.has(item.id)).map(item => item.id);
            await moveStickersToFront(ordered);
            setSelected(new Set());
            reload();
        } catch {
            onError('排序没生效');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.stickerPanel}>
            <div className={styles.stickerTabs}>
                <button
                    type="button"
                    aria-pressed={tab === 'mine'}
                    onClick={() => { setTab('mine'); setSelected(new Set()); }}
                >
                    我的
                </button>
                <button
                    type="button"
                    aria-pressed={tab === 'theirs'}
                    onClick={() => { setTab('theirs'); setOrganizing(false); setSelected(new Set()); }}
                >
                    对方的
                </button>
                <span className={styles.stickerSpacer} />
                {/* 整理只对自己的表情开放——对方的删不了，给个进不去的
                    按钮只会让人点了才知道不行。 */}
                {tab === 'mine' && (
                    <button
                        type="button"
                        className={styles.stickerTextButton}
                        onClick={() => { setOrganizing(value => !value); setSelected(new Set()); }}
                    >
                        {organizing ? '完成' : '整理'}
                    </button>
                )}
                <button
                    type="button"
                    className={styles.stickerTextButton}
                    onClick={onClose}
                    aria-label="关闭表情面板"
                >
                    收起
                </button>
            </div>

            <div className={styles.stickerGrid}>
                {tab === 'mine' && !organizing && (
                    <label className={styles.stickerUpload}>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            multiple
                            disabled={busy}
                            onChange={event => {
                                void upload(event.target.files);
                                event.target.value = '';
                            }}
                        />
                        <Upload size={18} />
                        <span>{busy ? '上传中' : '添加'}</span>
                    </label>
                )}

                {shown.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={styles.stickerCell}
                        data-selected={organizing && selected.has(item.id) ? 'true' : undefined}
                        onClick={() => (organizing ? toggle(item.id) : onPick(item))}
                        aria-label={organizing ? '选中这个表情' : '发送这个表情'}
                    >
                        {/* 表情是运行时的用户上传，next/image 声明不了域名 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={apiUrl(item.url)} alt="" loading="lazy" />
                    </button>
                ))}

                {shown.length === 0 && (
                    <p className={styles.stickerEmpty}>
                        {tab === 'mine'
                            ? '还没有表情。点「添加」上传，或者在聊天里右键一张图存下来。'
                            : '对方还没存过表情。'}
                    </p>
                )}
            </div>

            {organizing && selected.size > 0 && (
                <div className={styles.stickerActions}>
                    <span>{selected.size} 个</span>
                    <button type="button" onClick={() => void promoteSelected()} disabled={busy}>
                        移到最前
                    </button>
                    <button
                        type="button"
                        className={styles.stickerDanger}
                        onClick={() => void removeSelected()}
                        disabled={busy}
                    >
                        <Trash2 size={14} /> 删除
                    </button>
                </div>
            )}
        </div>
    );
}
