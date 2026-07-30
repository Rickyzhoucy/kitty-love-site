'use client';

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './page.module.css';

export interface LightboxImage {
    src: string;
    alt: string;
    downloadUrl?: string;
}

/**
 * 图片放大层。
 *
 * 用 portal 挂到 body：对话本的 `.page` 是 `overflow: hidden` 的网格容器，
 * 在里面渲染全屏遮罩会被裁掉。
 */
export default function Lightbox({
    image,
    onClose,
}: {
    image: LightboxImage | null;
    onClose: () => void;
}) {
    const handleKey = useCallback(
        (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        },
        [onClose],
    );

    useEffect(() => {
        if (!image) return;
        document.addEventListener('keydown', handleKey);
        // 打开时锁住背景滚动，否则在遮罩上滚滚轮会把下面的对话滚走
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.body.style.overflow = previous;
        };
    }, [image, handleKey]);

    if (!image || typeof document === 'undefined') return null;

    return createPortal(
        <div
            className={styles.lightbox}
            role="dialog"
            aria-modal="true"
            aria-label={image.alt || '查看大图'}
            onClick={onClose}
        >
            <button type="button" className={styles.lightboxClose} aria-label="关闭">
                ×
            </button>
            {/* 阻止冒泡：点图片本身不该关掉，只有点背景才关 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={image.src}
                alt={image.alt}
                onClick={event => event.stopPropagation()}
            />
            {image.downloadUrl && (
                <a
                    className={styles.lightboxDownload}
                    href={image.downloadUrl}
                    download
                    onClick={event => event.stopPropagation()}
                >
                    下载原图
                </a>
            )}
        </div>,
        document.body,
    );
}
