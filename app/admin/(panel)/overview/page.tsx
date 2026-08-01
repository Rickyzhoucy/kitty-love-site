'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brain, MessageSquareWarning, Puzzle, Settings2, Users } from 'lucide-react';
import Card from '../../../components/ui/Card';
import { adminApi, type DashboardPayload } from '@/lib/api/admin';

/** 总览。**只放「一眼看出有没有出事」的数字**，不做花哨的图表。 */
export default function OverviewPage() {
    const [data, setData] = useState<DashboardPayload | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const payload = await adminApi.dashboard().catch(() => null);
            if (!cancelled && payload) setData(payload);
        })();
        return () => { cancelled = true; };
    }, []);

    if (!data) {
        return <p className="text-sm text-ink-muted">加载中…</p>;
    }

    const tiles = [
        { label: '记忆', value: data.counts.memories, href: '/admin/memories', icon: Brain },
        { label: '技能', value: data.counts.skills, href: '/admin/skills', icon: Puzzle },
        { label: '主站账号', value: data.counts.users, href: '/admin/accounts', icon: Users },
        { label: '被改过的配置', value: data.configOverrides, href: '/admin/system', icon: Settings2 },
    ];

    return (
        <div className="flex flex-col gap-4">
            <h1 className="m-0 font-display text-2xl text-ink">总览</h1>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map(({ label, value, href, icon: Icon }) => (
                    <Link key={label} href={href} className="no-underline">
                        <Card className="p-4 transition-shadow hover:shadow-lift">
                            <Icon size={18} className="text-accent" />
                            <p className="mb-0 mt-2 text-2xl font-semibold tabular-nums text-ink">
                                {value ?? 0}
                            </p>
                            <p className="mb-0 mt-0.5 text-xs text-ink-muted">{label}</p>
                        </Card>
                    </Link>
                ))}
            </div>

            {data.failedToolRuns > 0 && (
                <Card className="flex items-center gap-3 border-danger/30 p-4">
                    <MessageSquareWarning size={18} className="shrink-0 text-danger" />
                    <p className="m-0 text-sm text-ink">
                        有 <span className="font-semibold text-danger">{data.failedToolRuns}</span> 次工具调用失败。
                        <Link href="/admin/skills" className="ml-1 text-accent">去看看</Link>
                    </p>
                </Card>
            )}

            <Card className="p-5">
                <h2 className="m-0 mb-3 font-display text-lg text-ink">此刻的设定</h2>
                <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    {[
                        ['对话模型', data.chatModel],
                        ['向量模型', data.embeddingModel],
                        ['每天最多思考', `${data.pet.dailyCallBudget} 次`],
                        ['每天最多主动说话', `${data.pet.dailyProactiveBudget} 次`],
                        ['静默时段', data.pet.quiet],
                    ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3 border-b border-ink/5 pb-1.5">
                            <dt className="m-0 text-ink-muted">{label}</dt>
                            <dd className="m-0 truncate text-ink">{value}</dd>
                        </div>
                    ))}
                </dl>
            </Card>
        </div>
    );
}
