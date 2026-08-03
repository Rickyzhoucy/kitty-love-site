'use client';

import { useEffect, useRef, useState } from 'react';
import { isTauriDesktop } from './desktop';

/**
 * 聊天框里打 `@` 时的本地文件候选。
 *
 * ## 只在桌面版有
 *
 * 网页版没有本地文件系统可言——那边要传文件用原来的上传按钮。所以这个 hook
 * 在浏览器里永远返回空数组，调用方**不需要自己判断环境**。
 *
 * ## 为什么是「附加」而不是「让宠物去读」
 *
 * 选中之后走的是站点现有的附件管线（上传成 Attachment，PDF/docx 会被解析），
 * 而不是往消息里插一个路径让宠物自己去调 `local_read`。两个原因：
 *
 * 1. **私聊里的宠物拿不到本地文件工具**（见 backend/app/agents/roles.py）。
 *    那一档带着联网搜索，而联网结果是不可信输入，不该和本地文件权限同轮出现。
 * 2. 「你亲手选的这个文件」比「模型自己决定去读哪个」的授权语义清楚得多。
 */

export interface LocalFileCandidate {
    path: string;
    name: string;
    isDir: boolean;
    size: number;
}

/** 候选查询的防抖。打字时每个键都查一次盘会很吵。 */
const DEBOUNCE_MS = 140;

export function useLocalFileCandidates(query: string | null): LocalFileCandidate[] {
    const [candidates, setCandidates] = useState<LocalFileCandidate[]>([]);
    const latest = useRef(0);

    useEffect(() => {
        if (query === null || !isTauriDesktop()) {
            setCandidates([]);
            return;
        }
        const ticket = ++latest.current;
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const found = await invoke<LocalFileCandidate[]>('search_local_files', {
                        query,
                    });
                    // 慢查询回来时用户可能已经改了输入。只认最后一次的结果，
                    // 否则候选会闪回上一个词的匹配。
                    if (ticket === latest.current) setCandidates(found);
                } catch {
                    if (ticket === latest.current) setCandidates([]);
                }
            })();
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    return candidates;
}

/**
 * 把选中的本地文件读成一个可上传的 `File`。
 *
 * 字节由 Rust 侧读出（网页层没有文件系统访问权，这是刻意的），
 * 经 base64 过 IPC 传回来。
 */
export async function readLocalFileForUpload(path: string): Promise<File> {
    const { invoke } = await import('@tauri-apps/api/core');
    const payload = await invoke<{ name: string; base64: string }>(
        'read_local_attachment',
        { path },
    );
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    // 不指定 MIME：服务端按扩展名和内容自己判断，前端瞎猜一个反而会误导
    // 后续的解析分支。
    return new File([bytes], payload.name);
}

/** 人话文件大小，给候选列表用。 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
