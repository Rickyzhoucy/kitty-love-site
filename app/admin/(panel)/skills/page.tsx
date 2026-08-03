'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '../../../components/ui/Card';
import {
    adminApi,
    type SkillRow,
    type SkillVersionRow,
    type ToolRunRow,
} from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 可执行扩展的完整控制面：安装、版本激活、启停，以及工具调用审计。
 * 这些操作只在 Admin 出现，普通用户侧不暴露可执行扩展的变更入口。
 */
export default function SkillsPage() {
    const [skills, setSkills] = useState<SkillRow[]>([]);
    const [runs, setRuns] = useState<ToolRunRow[]>([]);
    const [summary, setSummary] = useState<{ tool: string; status: string; count: number }[]>([]);
    const [versions, setVersions] = useState<Record<string, SkillVersionRow[]>>({});
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const [archive, setArchive] = useState<File | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        const [skillList, runData] = await Promise.all([
            adminApi.skills(),
            adminApi.toolRuns({ limit: '80' }),
        ]);
        setSkills(skillList);
        setRuns(runData.runs);
        setSummary(runData.summary);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [skillList, runData] = await Promise.all([
                adminApi.skills().catch(() => []),
                adminApi.toolRuns({ limit: '80' }).catch(() => null),
            ]);
            if (cancelled) return;
            setSkills(skillList);
            if (runData) {
                setRuns(runData.runs);
                setSummary(runData.summary);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const toggle = async (skill: SkillRow) => {
        setBusy(skill.id);
        setError('');
        try {
            await adminApi.toggleSkill(skill.id, !skill.enabled);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '技能状态更新失败');
        } finally {
            setBusy(null);
        }
    };

    const showVersions = async (skill: SkillRow) => {
        if (expandedSkill === skill.id) {
            setExpandedSkill(null);
            return;
        }
        setBusy(`versions:${skill.id}`);
        setError('');
        try {
            const rows = await adminApi.skillVersions(skill.id);
            setVersions(current => ({ ...current, [skill.id]: rows }));
            setExpandedSkill(skill.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '版本读取失败');
        } finally {
            setBusy(null);
        }
    };

    const activate = async (skillId: string, versionId: string) => {
        setBusy(`activate:${versionId}`);
        setError('');
        try {
            await adminApi.activateSkillVersion(skillId, versionId);
            const [rows] = await Promise.all([adminApi.skillVersions(skillId), load()]);
            setVersions(current => ({ ...current, [skillId]: rows }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '版本激活失败');
        } finally {
            setBusy(null);
        }
    };

    const install = async () => {
        if (!archive) return;
        setBusy('upload');
        setError('');
        try {
            await adminApi.uploadSkill(archive);
            setArchive(null);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Skill 安装失败');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <h1 className="m-0 font-display text-2xl text-ink">技能与调用</h1>

            <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="m-0 font-display text-lg text-ink">服务器 Skills</h2>
                        <p className="m-0 mt-1 text-xs text-ink-muted">
                            ZIP 会在服务器校验、存储和执行；客户端不会安装或运行 Skill。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-xl border border-ink/10 bg-surface px-3 py-2 text-xs text-ink hover:bg-sunken">
                            {archive ? archive.name : '选择 Skill ZIP'}
                            <input
                                type="file"
                                accept=".zip,application/zip"
                                className="sr-only"
                                onChange={event => setArchive(event.target.files?.[0] ?? null)}
                            />
                        </label>
                        <button
                            type="button"
                            disabled={!archive || busy === 'upload'}
                            onClick={install}
                            className="rounded-xl bg-ink px-3 py-2 text-xs text-surface disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy === 'upload' ? '校验安装中…' : '安装新版本'}
                        </button>
                    </div>
                </div>
                {error && (
                    <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
                )}
                {skills.length === 0 ? (
                    <p className="m-0 text-sm text-ink-muted">还没有安装任何技能。</p>
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {skills.map(skill => (
                            <li key={skill.id} className="border-b border-ink/5 pb-2 last:border-0">
                                <div className="flex items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="m-0 truncate text-sm text-ink">{skill.name}</p>
                                        <p className="m-0 truncate text-xs text-ink-muted">
                                            {skill.description || '（没有说明）'} · {skill.versionCount} 个版本
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={busy === `versions:${skill.id}`}
                                        onClick={() => showVersions(skill)}
                                        className="shrink-0 rounded-full bg-sunken px-3 py-1 text-xs text-ink-muted hover:bg-sunken/70 disabled:opacity-40"
                                    >
                                        {expandedSkill === skill.id ? '收起版本' : '管理版本'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy === skill.id || (!skill.enabled && !skill.activeVersionId)}
                                        onClick={() => toggle(skill)}
                                        className={cn(
                                            'shrink-0 rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                                            skill.enabled
                                                ? 'bg-success/15 text-success hover:bg-success/25'
                                                : 'bg-sunken text-ink-muted hover:bg-sunken/70',
                                        )}
                                    >
                                        {skill.enabled ? '已启用' : '已停用'}
                                    </button>
                                </div>
                                {expandedSkill === skill.id && (
                                    <div className="mt-2 rounded-xl bg-sunken/60 p-2">
                                        {(versions[skill.id] ?? []).map(version => (
                                            <div key={version.id} className="flex items-center gap-2 py-1 text-xs">
                                                <code className="min-w-0 flex-1 truncate text-ink-muted">
                                                    {version.revision} · {version.sha256.slice(0, 12)}
                                                </code>
                                                {version.active ? (
                                                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">当前版本</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={busy === `activate:${version.id}`}
                                                        onClick={() => activate(skill.id, version.id)}
                                                        className="rounded-full bg-surface px-2 py-0.5 text-ink hover:bg-white disabled:opacity-40"
                                                    >
                                                        激活
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {summary.length > 0 && (
                <Card className="p-5">
                    <h2 className="m-0 mb-3 font-display text-lg text-ink">调用统计</h2>
                    <div className="flex flex-wrap gap-2">
                        {summary.map(item => (
                            <span
                                key={`${item.tool}-${item.status}`}
                                className={cn(
                                    'rounded-full px-3 py-1 text-xs',
                                    item.status === 'failed'
                                        ? 'bg-danger/15 text-danger'
                                        : 'bg-sunken text-ink-muted',
                                )}
                            >
                                {item.tool} · {item.status} · {item.count}
                            </span>
                        ))}
                    </div>
                </Card>
            )}

            <Card className="p-5">
                <h2 className="m-0 mb-3 font-display text-lg text-ink">最近的调用</h2>
                {runs.length === 0 ? (
                    <p className="m-0 text-sm text-ink-muted">还没有调用记录。</p>
                ) : (
                    <div className="-mx-5 overflow-x-auto px-5">
                        <table className="w-full min-w-[34rem] border-collapse text-sm">
                            <thead>
                                <tr className="text-left text-xs text-ink-muted">
                                    <th className="pb-2 font-normal">工具</th>
                                    <th className="pb-2 font-normal">状态</th>
                                    <th className="pb-2 font-normal">时间</th>
                                    <th className="pb-2 font-normal">结果大小</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runs.map(run => (
                                    <tr key={run.id} className="border-t border-ink/5">
                                        <td className="py-1.5 pr-3 text-ink">{run.tool}</td>
                                        <td className={cn(
                                            'py-1.5 pr-3',
                                            run.status === 'failed' ? 'text-danger' : 'text-ink-muted',
                                        )}>
                                            {run.status}
                                        </td>
                                        <td className="py-1.5 pr-3 tabular-nums text-ink-muted">
                                            {new Date(run.createdAt).toLocaleString('zh-CN')}
                                        </td>
                                        <td className="py-1.5 tabular-nums text-ink-muted">
                                            {run.resultSize}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
