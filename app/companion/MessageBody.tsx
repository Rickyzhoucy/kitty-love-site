'use client';

import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { apiUrl } from '@/lib/api/client';
import styles from './page.module.css';

/**
 * 消息正文。
 *
 * **为什么要渲染 Markdown**：模型的输出本来就是 Markdown。原样当纯文本显示，
 * 用户看到的是满屏的 `**`、`- ` 和 `[标题](链接)`，链接还点不动。
 *
 * **为什么不 dangerouslySetInnerHTML**：正文里有模型生成的内容，而模型读过
 * 的网页里可能有人写了 `<img onerror=...>`。react-markdown 默认会把原始 HTML
 * 当文本转义，不接 rehype-raw 就没有这条注入路径。
 */

/** 站内附件链接直接指向 API，需要补上 base；站外链接原样。 */
function resolveHref(href: string): string {
    return href.startsWith('/api/') ? apiUrl(href) : href;
}

function isInternal(href: string): boolean {
    return href.startsWith('/');
}

export default function MessageBody({
    content,
    onZoom,
}: {
    content: string;
    onZoom?: (image: { src: string; alt: string }) => void;
}) {
    return (
        <div className={styles.markdown}>
            <ReactMarkdown
                // gfm：表格、删除线、任务列表，以及**裸链接自动成链**——模型
                //   经常直接甩一个 https://…，不加这个它就是一段死文本。
                // breaks：单个换行也换行。标准 Markdown 会把它当空格吞掉，
                //   而用户在输入框里按 Shift+Enter 打出来的换行是有意的。
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    a({ href, children, ...props }) {
                        const target = resolveHref(String(href ?? ''));
                        return (
                            <a
                                {...props}
                                href={target}
                                // 站内附件在同标签页打开会触发下载；站外链接
                                // 另开一页，避免把人从对话里带走。
                                target={isInternal(String(href ?? '')) ? undefined : '_blank'}
                                rel="noreferrer"
                            >
                                {children}
                            </a>
                        );
                    },
                    img({ src, alt, ...props }) {
                        const source = resolveHref(String(src ?? ''));
                        return (
                            // next/image 要求预先声明远端域名，而这里的图片地址
                            // 是模型运行时给的，声明不了。
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                {...props}
                                src={source}
                                alt={alt ?? ''}
                                loading="lazy"
                                onClick={() => onZoom?.({ src: source, alt: alt ?? '' })}
                            />
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
