'use client';

import Markdown from '../components/Markdown';
import styles from './page.module.css';

/**
 * 对话本里的消息正文。
 *
 * 渲染本身在 `components/Markdown`（那里说明了为什么不接 rehype-raw）；
 * 这里只负责给它这一处的排版——整页阅读的密度，与宠物气泡那种一小块不同。
 */
export default function MessageBody({
    content,
    onZoom,
}: {
    content: string;
    onZoom?: (image: { src: string; alt: string }) => void;
}) {
    return <Markdown content={content} className={styles.markdown} onZoom={onZoom} />;
}
