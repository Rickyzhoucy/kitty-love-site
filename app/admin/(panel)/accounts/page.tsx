'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { adminApi, type AccountRow } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 账号：主站那两个人的，以及后台自己的密码。
 *
 * **重置主站密码会同时踢掉该账号全部会话。** 真会用到这个功能的场景（密码
 * 泄露、手机丢了）恰恰是必须让已登录设备下线的场景——只改密码不踢会话等于
 * 没改。
 */
export default function AccountsPage() {
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [resetting, setResetting] = useState<Record<string, string>>({});
    const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');

    const load = useCallback(async () => {
        setAccounts(await adminApi.accounts());
    }, []);

    // 带取消标记，而不是直接 `void load()`：组件卸下之后再 setState 是无效更新，
    // 而 React 19 的 lint 也会拦「在 effect 里同步 setState」。
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const rows = await adminApi.accounts().catch(() => null);
            if (!cancelled && rows) setAccounts(rows);
        })();
        return () => { cancelled = true; };
    }, []);

    const resetPassword = async (row: AccountRow) => {
        const password = resetting[row.id];
        if (!password || password.length < 8) {
            setNote({ kind: 'error', text: '新密码至少 8 位' });
            return;
        }
        await adminApi.resetAccountPassword(row.id, password);
        setResetting(state => ({ ...state, [row.id]: '' }));
        setNote({ kind: 'ok', text: `已重置 ${row.username} 的密码，并踢掉了全部会话` });
        await load();
    };

    const changeMine = async () => {
        if (next.length < 10) {
            setNote({ kind: 'error', text: '后台密码至少 10 位' });
            return;
        }
        try {
            await adminApi.changePassword(current, next);
            setCurrent('');
            setNext('');
            setNote({ kind: 'ok', text: '后台密码已更新' });
        } catch (error) {
            setNote({ kind: 'error', text: error instanceof Error ? error.message : '修改失败' });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="m-0 font-display text-2xl text-ink">账号</h1>
                {note && (
                    <span className={cn('text-sm', note.kind === 'ok' ? 'text-success' : 'text-danger')}>
                        {note.text}
                    </span>
                )}
            </header>

            <Card className="p-5">
                <h2 className="m-0 mb-1 font-display text-lg text-ink">主站账号</h2>
                <p className="mb-4 mt-0 text-xs text-ink-muted">
                    重置密码会同时把该账号已登录的设备全部踢下线。
                </p>
                <div className="flex flex-col gap-4">
                    {accounts.map(row => (
                        <div key={row.id} className="border-b border-ink/5 pb-4 last:border-0 last:pb-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-sm text-ink">{row.displayName}</span>
                                <span className="font-mono text-xs text-ink-muted">@{row.username}</span>
                                <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-muted">
                                    {row.activeSessions} 个活跃会话
                                </span>
                                {!row.enabled && (
                                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] text-danger">
                                        已停用
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    type="password"
                                    className="min-w-[12rem] flex-1"
                                    placeholder="设一个新密码"
                                    autoComplete="new-password"
                                    value={resetting[row.id] ?? ''}
                                    onChange={event => setResetting(state => ({
                                        ...state, [row.id]: event.target.value,
                                    }))}
                                />
                                <Button onClick={() => resetPassword(row)}>
                                    <KeyRound size={15} />
                                    重置
                                </Button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        await adminApi.revokeSessions(row.id);
                                        setNote({ kind: 'ok', text: `已踢掉 ${row.username} 的全部会话` });
                                        await load();
                                    }}
                                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                                    title="不改密码，只让已登录的设备重新登录"
                                >
                                    <LogOut size={15} />
                                    踢下线
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            <Card className="p-5">
                <h2 className="m-0 mb-1 flex items-center gap-2 font-display text-lg text-ink">
                    <ShieldCheck size={17} className="text-accent" />
                    后台密码
                </h2>
                <p className="mb-4 mt-0 text-xs text-ink-muted">
                    要先填当前密码——会话可能是别人在你没锁屏的电脑上捡的。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        type="password"
                        className="min-w-[10rem] flex-1"
                        placeholder="当前密码"
                        autoComplete="current-password"
                        value={current}
                        onChange={event => setCurrent(event.target.value)}
                    />
                    <Input
                        type="password"
                        className="min-w-[10rem] flex-1"
                        placeholder="新密码（至少 10 位）"
                        autoComplete="new-password"
                        value={next}
                        onChange={event => setNext(event.target.value)}
                    />
                    <Button onClick={changeMine} disabled={!current || !next}>
                        修改
                    </Button>
                </div>
            </Card>
        </div>
    );
}
