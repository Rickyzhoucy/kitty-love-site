'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Search, Trash2 } from 'lucide-react';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { adminApi, type MemoryRow } from '@/lib/api/admin';

/**
 * 记忆管理。
 *
 * 在这之前记忆是**只写的**：宠物往里存，没有任何界面能看、能改、能删。它记错
 * 了一件事，你只能眼看着它一直记错。
 *
 * 删除会连带删掉向量（`MemoryEmbedding` 的外键是 CASCADE），不会在向量库里
 * 留下检索得到、却已经没有正文的孤儿。
 */
export default function MemoriesPage() {
    const [rows, setRows] = useState<MemoryRow[]>([]);
    const [facets, setFacets] = useState<{
        kinds: { value: string; count: number }[];
        scopes: { value: string; count: number }[];
        total: number;
    } | null>(null);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('');
    const [minImportance, setMinImportance] = useState(0);
    const [editing, setEditing] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true);
        try {
            const [list, facetData] = await Promise.all([
                adminApi.memories({ q: query, kind, min_importance: minImportance, limit: 200 }),
                adminApi.memoryFacets(),
            ]);
            setRows(list);
            setFacets(facetData);
        } finally {
            setBusy(false);
        }
    }, [query, kind, minImportance]);

    useEffect(() => {
        let cancelled = false;
        void load().catch(() => undefined).finally(() => {
            if (cancelled) return;
        });
        return () => { cancelled = true; };
    }, [load]);

    const saveOne = async (row: MemoryRow) => {
        const content = editing[row.id];
        if (content === undefined) return;
        await adminApi.updateMemory(row.id, { content });
        setEditing(current => {
            const next = { ...current };
            delete next[row.id];
            return next;
        });
        await load();
    };

    const remove = async (row: MemoryRow) => {
        // 记忆删了就没了，而且这里删的是宠物「记得的事」——问一句不过分。
        if (!window.confirm(`删掉这条记忆？\n\n${row.content.slice(0, 60)}…`)) return;
        await adminApi.deleteMemory(row.id);
        await load();
    };

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h1 className="m-0 font-display text-2xl text-ink">记忆</h1>
                <p className="mb-0 mt-1 text-sm text-ink-muted">
                    共 {facets?.total ?? 0} 条。改内容会即时影响宠物的回答，删除会连向量一起删。
                </p>
            </header>

            <Card className="flex flex-wrap items-end gap-3 p-4">
                <div className="relative min-w-[12rem] flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                    <Input
                        className="pl-9"
                        placeholder="搜正文"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                </div>
                <select
                    value={kind}
                    onChange={event => setKind(event.target.value)}
                    className="rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm text-ink"
                >
                    <option value="">全部类型</option>
                    {facets?.kinds.map(item => (
                        <option key={item.value} value={item.value}>
                            {item.value}（{item.count}）
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                    重要度 ≥
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        className="w-20"
                        value={minImportance}
                        onChange={event => setMinImportance(Number(event.target.value) || 0)}
                    />
                </label>
            </Card>

            {busy && <p className="m-0 text-sm text-ink-muted">加载中…</p>}

            <div className="flex flex-col gap-2">
                {rows.map(row => {
                    const draft = editing[row.id];
                    return (
                        <Card key={row.id} className="p-4">
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                                <span className="rounded-full bg-sunken px-2 py-0.5">{row.kind}</span>
                                <span className="rounded-full bg-sunken px-2 py-0.5">{row.scope}</span>
                                <span className="tabular-nums">重要度 {row.importance}</span>
                                <span className="ml-auto tabular-nums">
                                    {new Date(row.created_at).toLocaleString('zh-CN')}
                                </span>
                            </div>

                            <textarea
                                value={draft ?? row.content}
                                onChange={event => setEditing(current => ({
                                    ...current, [row.id]: event.target.value,
                                }))}
                                rows={Math.min(6, Math.ceil((draft ?? row.content).length / 60) + 1)}
                                className="w-full resize-y rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
                            />

                            <div className="mt-2 flex items-center gap-2">
                                {draft !== undefined && (
                                    <Button onClick={() => saveOne(row)}>
                                        <Check size={15} />
                                        保存
                                    </Button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => remove(row)}
                                    className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                                >
                                    <Trash2 size={15} />
                                    删除
                                </button>
                            </div>
                        </Card>
                    );
                })}
                {!busy && rows.length === 0 && (
                    <p className="m-0 py-8 text-center text-sm text-ink-muted">没有符合条件的记忆</p>
                )}
            </div>
        </div>
    );
}
