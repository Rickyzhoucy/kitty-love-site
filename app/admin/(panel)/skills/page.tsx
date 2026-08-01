'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '../../../components/ui/Card';
import { adminApi, type SkillRow, type ToolRunRow } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 技能开关，以及工具调用记录。
 *
 * 技能表和 API 早就有了（`Skill.enabled` 字段一直在），缺的只是一个能按的开关。
 * 工具调用记录那半边回答的是另一个问题：**它到底在调什么、哪个老是失败**。
 */
export default function SkillsPage() {
    const [skills, setSkills] = useState<SkillRow[]>([]);
    const [runs, setRuns] = useState<ToolRunRow[]>([]);
    const [summary, setSummary] = useState<{ tool: string; status: string; count: number }[]>([]);

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
        await adminApi.toggleSkill(skill.id, !skill.enabled);
        await load();
    };

    return (
        <div className="flex flex-col gap-4">
            <h1 className="m-0 font-display text-2xl text-ink">技能与调用</h1>

            <Card className="p-5">
                <h2 className="m-0 mb-3 font-display text-lg text-ink">技能</h2>
                {skills.length === 0 ? (
                    <p className="m-0 text-sm text-ink-muted">还没有安装任何技能。</p>
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {skills.map(skill => (
                            <li key={skill.id} className="flex items-center gap-3 border-b border-ink/5 pb-2 last:border-0">
                                <div className="min-w-0 flex-1">
                                    <p className="m-0 truncate text-sm text-ink">{skill.name}</p>
                                    <p className="m-0 truncate text-xs text-ink-muted">
                                        {skill.description || '（没有说明）'} · {skill.versionCount} 个版本
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggle(skill)}
                                    className={cn(
                                        'shrink-0 rounded-full px-3 py-1 text-xs transition-colors',
                                        skill.enabled
                                            ? 'bg-success/15 text-success hover:bg-success/25'
                                            : 'bg-sunken text-ink-muted hover:bg-sunken/70',
                                    )}
                                >
                                    {skill.enabled ? '已启用' : '已停用'}
                                </button>
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
