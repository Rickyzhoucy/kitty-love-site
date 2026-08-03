'use client';

import { useState, type ImgHTMLAttributes } from 'react';

type FallbackImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
    primarySrc?: string | null;
    fallbackSrc?: string | null;
};

/** 主地址失败时只回退一次；两边都失败也不会形成请求循环。 */
export default function FallbackImage({
    primarySrc,
    fallbackSrc,
    alt = '',
    ...props
}: FallbackImageProps) {
    const [usingFallback, setUsingFallback] = useState(false);
    const src = usingFallback ? fallbackSrc || '' : primarySrc || fallbackSrc || '';

    if (!src) return null;

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            {...props}
            src={src}
            alt={alt}
            onError={() => {
                if (fallbackSrc && src !== fallbackSrc) setUsingFallback(true);
            }}
        />
    );
}
