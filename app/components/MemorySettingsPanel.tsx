'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BookHeart,
    Check,
    ChevronDown,
    ChevronUp,
    Eye,
    EyeOff,
    History,
    PencilLine,
    Plus,
    RotateCcw,
    Search,
    Trash2,
    Users,
} from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import {
    correctMemory,
    createMemory,
    excludeMemoryEvidence,
    getMemoryPreferences,
    listMemories,
    memoryEvidence,
    restoreMemory,
    retractMemory,
    updateMemoryPreferences,
    type MemoryEvidence,
    type MemoryPreference,
    type MemoryRecord,
    type MemoryStatus,
    type MemoryVisibility,
    approveMemory,
} from '@/lib/api/memories';
import { useToast } from './ui/Toast';

const VISIBILITIES: Array<{ id: MemoryVisibility; label: string; hint: string }> = [
    { id: 'user_private', label: '关于我', hint: '只有你的宠物对话能引用' },
    { id: 'couple_shared', label: '关于我们', hint: '两个人和聊天里的宠物都能引用' },
    { id: 'companion_relationship', label: '我和宠物', hint: '宠物和你相处形成的经历' },
];

const STATUS_TABS: Array<{ id: MemoryStatus; label: string }> = [
    { id: 'active', label: '正在使用' },
    { id: 'pending_review', label: '待确认' },
    { id: 'retracted', label: '已忘记' },
];

const SOURCE_LABELS: Record<string, string> = {
    explicit_user: '你明确告诉宠物',
    chat_message: '私人宠物对话',
    direct_message: '两个人的聊天',
    pet_event: '你和宠物的经历',
    resource_event: '站内内容变化',
    admin: '管理端迁移',
};

function errorMessage(error: unknown): string {
    return error instanceof ApiError ? error.message : '操作没有完成，请稍后再试';
}

function Toggle({
    checked,
    disabled = false,
    label,
    hint,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    hint: string;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className={`flex min-h-14 items-center justify-between gap-4 rounded-md px-3 py-2 transition-colors ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-accent-soft/40'}`}>
            <span>
                <span className="block text-sm font-semibold text-ink">{label}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
            </span>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                className="h-5 w-5 accent-accent"
            />
        </label>
    );
}

export default function MemorySettingsPanel() {
    const { toast } = useToast();
    const [visibility, setVisibility] = useState<MemoryVisibility>('user_private');
    const [status, setStatus] = useState<MemoryStatus>('active');
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<MemoryRecord[]>([]);
    const [preferences, setPreferences] = useState<MemoryPreference | null>(null);
    const [loading, setLoading] = useState(true);
    const [newContent, setNewContent] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [evidence, setEvidence] = useState<Record<string, MemoryEvidence[]>>({});
    const [editing, setEditing] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [records, settings] = await Promise.all([
                listMemories({ visibility, status, query }),
                getMemoryPreferences(),
            ]);
            setItems(records);
            setPreferences(settings);
        } catch (error) {
            toast(errorMessage(error), 'error');
        } finally {
            setLoading(false);
        }
    }, [query, status, toast, visibility]);

    useEffect(() => { void load(); }, [load]);

    const currentVisibility = useMemo(
        () => VISIBILITIES.find(item => item.id === visibility)!,
        [visibility],
    );

    const toggleEvidence = async (item: MemoryRecord) => {
        if (expanded === item.id) {
            setExpanded(null);
            return;
        }
        setExpanded(item.id);
        if (evidence[item.id]) return;
        try {
            const sources = await memoryEvidence(item.id);
            setEvidence(previous => ({ ...previous, [item.id]: sources }));
        } catch (error) {
            toast(errorMessage(error), 'error');
        }
    };

    const add = async () => {
        const content = newContent.trim();
        if (!content) return;
        try {
            const result = await createMemory({
                visibility,
                memoryType: visibility === 'companion_relationship' ? 'relationship' : 'fact',
                content,
                importance: 80,
            });
            setNewContent('');
            toast(result.receipt.safeSummary);
            await load();
        } catch (error) {
            toast(errorMessage(error), 'error');
        }
    };

    const saveEdit = async (item: MemoryRecord) => {
        const content = editContent.trim();
        if (!content || content === item.content) {
            setEditing(null);
            return;
        }
        try {
            const result = await correctMemory(item.id, content);
            toast(result.receipt.safeSummary);
            setEditing(null);
            await load();
        } catch (error) {
            toast(errorMessage(error), 'error');
        }
    };

    const updatePreference = async (changes: Partial<MemoryPreference>) => {
        if (!preferences) return;
        const before = preferences;
        setPreferences({ ...preferences, ...changes });
        try {
            setPreferences(await updateMemoryPreferences(changes));
            toast('记忆来源设置已更新');
        } catch (error) {
            setPreferences(before);
            toast(errorMessage(error), 'error');
        }
    };

    return (
        <section aria-labelledby="memory-heading" className="space-y-4">
            <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <BookHeart size={21} aria-hidden="true" />
                </span>
                <div>
                    <h2 id="memory-heading" className="m-0 font-display text-xl text-ink">宠物记忆</h2>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                        你能看见宠物记住了什么、从哪里得知，也能随时纠正或忘记。
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="记忆范围">
                {VISIBILITIES.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={visibility === item.id}
                        onClick={() => setVisibility(item.id)}
                        className={`min-h-14 rounded-md border px-3 py-2 text-left transition-colors ${
                            visibility === item.id
                                ? 'border-accent/30 bg-accent-soft text-accent-strong'
                                : 'border-ink/5 bg-canvas/50 text-ink hover:bg-accent-soft/40'
                        }`}
                    >
                        <span className="flex items-center gap-1.5 text-sm font-bold">
                            {item.id === 'couple_shared' ? <Users size={15} /> : <BookHeart size={15} />}
                            {item.label}
                        </span>
                        <span className="mt-1 block text-xs opacity-75">{item.hint}</span>
                    </button>
                ))}
            </div>

            {visibility !== 'companion_relationship' && (
                <div className="rounded-lg bg-canvas/65 p-3">
                    <label htmlFor="new-memory" className="text-sm font-semibold text-ink">
                        明确告诉宠物要记住
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <textarea
                            id="new-memory"
                            value={newContent}
                            onChange={event => setNewContent(event.target.value)}
                            rows={2}
                            placeholder={visibility === 'couple_shared' ? '例如：我们都不吃香菜' : '例如：我喜欢靠窗的位置'}
                            className="min-h-14 flex-1 resize-none rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/15"
                        />
                        <button
                            type="button"
                            onClick={() => { void add(); }}
                            disabled={!newContent.trim()}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-on-accent transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Plus size={17} />记住
                        </button>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-1 rounded-full bg-canvas p-1" role="tablist" aria-label="记忆状态">
                    {STATUS_TABS.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={status === tab.id}
                            onClick={() => setStatus(tab.id)}
                            className={`min-h-10 rounded-full px-3 text-xs font-bold ${status === tab.id ? 'bg-surface text-accent shadow-soft' : 'text-ink-muted'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <label className="relative block sm:w-56">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                    <span className="sr-only">搜索记忆</span>
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索记忆"
                        className="min-h-11 w-full rounded-full border border-ink/10 bg-surface pl-9 pr-3 text-sm outline-none focus:border-accent/50"
                    />
                </label>
            </div>

            <div className="space-y-2" aria-live="polite">
                {loading ? (
                    <p className="py-8 text-center text-sm text-ink-muted">正在翻记忆本…</p>
                ) : items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-ink/15 py-8 text-center text-sm text-ink-muted">
                        {currentVisibility.label}里还没有这类记忆
                    </p>
                ) : items.map(item => (
                    <article key={item.id} className="rounded-lg border border-ink/5 bg-canvas/40 p-4">
                        {editing === item.id ? (
                            <div className="space-y-2">
                                <textarea
                                    autoFocus
                                    value={editContent}
                                    onChange={event => setEditContent(event.target.value)}
                                    rows={3}
                                    className="w-full rounded-md border border-accent/30 bg-surface p-3 text-sm outline-none ring-2 ring-accent/10"
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-full px-4 text-sm text-ink-muted">取消</button>
                                    <button type="button" onClick={() => { void saveEdit(item); }} className="min-h-11 rounded-full bg-accent px-4 text-sm font-bold text-on-accent">保存纠正</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="m-0 text-sm leading-6 text-ink">{item.content}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
                                    <span>{item.createdByKind === 'user' ? '你明确记录' : '宠物从对话中整理'}</span>
                                    <span>可信度 {Math.round(item.confidence * 100)}%</span>
                                    {item.accessCount > 0 ? <span>已引用 {item.accessCount} 次</span> : <span>尚未引用</span>}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1">
                                    <button type="button" onClick={() => { void toggleEvidence(item); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-muted hover:bg-surface">
                                        <History size={15} />来源 {expanded === item.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                    {item.status !== 'retracted' && (
                                        <button type="button" onClick={() => { setEditing(item.id); setEditContent(item.content); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-muted hover:bg-surface">
                                            <PencilLine size={15} />纠正
                                        </button>
                                    )}
                                    {item.status === 'retracted' ? (
                                        <button type="button" onClick={async () => { try { const result = await restoreMemory(item.id); toast(result.receipt.safeSummary); await load(); } catch (error) { toast(errorMessage(error), 'error'); } }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-success hover:bg-surface">
                                            <RotateCcw size={15} />恢复
                                        </button>
                                    ) : item.status === 'pending_review' ? (
                                        <>
                                            <button type="button" onClick={async () => { try { const result = await approveMemory(item.id); toast(result.receipt.safeSummary); await load(); } catch (error) { toast(errorMessage(error), 'error'); } }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-success hover:bg-surface">
                                                <Check size={15} />确认使用
                                            </button>
                                            <button type="button" onClick={async () => { try { const result = await retractMemory(item.id); toast(result.receipt.safeSummary); await load(); } catch (error) { toast(errorMessage(error), 'error'); } }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-danger hover:bg-surface">
                                                <Trash2 size={15} />不是这样
                                            </button>
                                        </>
                                    ) : (
                                        <button type="button" onClick={async () => { try { const result = await retractMemory(item.id); toast(result.receipt.safeSummary); await load(); } catch (error) { toast(errorMessage(error), 'error'); } }} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-danger hover:bg-surface">
                                            <Trash2 size={15} />忘记
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                        {expanded === item.id && (
                            <div className="mt-3 border-t border-ink/5 pt-3">
                                {(evidence[item.id] ?? []).map(source => (
                                    <div key={source.id} className="mb-2 rounded-md bg-surface px-3 py-2 text-xs leading-5 text-ink-muted">
                                        <strong className="text-ink">{SOURCE_LABELS[source.sourceType] ?? source.sourceType}</strong>
                                        <span> · {new Date(source.observedAt).toLocaleString('zh-CN')}</span>
                                        {source.excerpt && <p className="m-0 mt-1 line-clamp-2">“{source.excerpt}”</p>}
                                        {source.sourceType !== 'explicit_user' && source.sourceType !== 'migration' && (
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        const result = await excludeMemoryEvidence(item.id, source.id);
                                                        toast(result.receipt.safeSummary);
                                                        setEvidence(previous => {
                                                            const next = { ...previous };
                                                            delete next[item.id];
                                                            return next;
                                                        });
                                                        setExpanded(null);
                                                        await load();
                                                    } catch (error) {
                                                        toast(errorMessage(error), 'error');
                                                    }
                                                }}
                                                className="mt-1 min-h-11 rounded-full px-3 font-semibold text-danger hover:bg-danger/5"
                                            >
                                                不再从这条来源记忆
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </article>
                ))}
            </div>

            {preferences && (
                <div className="rounded-lg border border-ink/5 bg-canvas/45 p-3">
                    <div className="flex items-center gap-2 px-3 pb-2 text-sm font-bold text-ink">
                        {!preferences.referenceEnabled ? <EyeOff size={17} /> : <Eye size={17} />}
                        你的隐私与授权
                    </div>
                    <Toggle checked={preferences.referenceAvailable && preferences.referenceEnabled} disabled={!preferences.referenceAvailable} label="在回答中引用记忆" hint={preferences.referenceAvailable ? '关闭后保留记忆本，但宠物回答时不读取' : '系统管理员已全站关闭记忆引用'} onChange={checked => { void updatePreference({ referenceEnabled: checked }); }} />
                    <Toggle checked={!preferences.paused} disabled={!preferences.privateExtractionAvailable && !preferences.sharedExtractionAvailable} label="允许自动形成新记忆" hint="关闭后仍可手动明确记录" onChange={checked => { void updatePreference({ paused: !checked }); }} />
                    <Toggle checked={preferences.privateExtractionAvailable && preferences.conversationEnabled} disabled={!preferences.privateExtractionAvailable} label="从我的宠物私聊整理" hint={preferences.privateExtractionAvailable ? '只以你本人说的话作为事实证据' : '系统管理员已关闭私聊自动整理'} onChange={checked => { void updatePreference({ conversationEnabled: checked }); }} />
                    <Toggle checked={preferences.sharedExtractionAvailable && preferences.directMessageEnabled} disabled={!preferences.sharedExtractionAvailable} label="从我发送的两人聊天整理" hint={preferences.sharedExtractionAvailable ? '只授权你自己发送的内容；写入双方共享域并保留说话人' : '系统管理员已关闭两人聊天自动整理'} onChange={checked => { void updatePreference({ directMessageEnabled: checked }); }} />
                </div>
            )}
        </section>
    );
}
