'use client';

import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import Button from './ui/Button';
import {
    deletePasskey,
    explain,
    guessDeviceLabel,
    isAvailable,
    listPasskeys,
    registerPasskey,
    type PasskeyRow,
} from '@/lib/passkey';
import { cn } from '@/lib/utils';

/**
 * 管理这个账号的 passkey。主站和后台共用，只是 `base` 不同。
 *
 * ## 必须在「当前设备上、以本人身份」注册
 *
 * 钥匙生成在设备的安全芯片里，服务端只拿到公钥。所以管理员**没法替别人加
 * 一把**——只能各自在自己手机上按一下。这也是为什么这个组件要出现在两个地方，
 * 而不是只放在后台。
 *
 * ## 删到一把不剩是允许的
 *
 * 不做「至少留一把」的限制：密码登录一直在，删光了也进得来。反过来，如果这里
 * 拦着不让删最后一把，换手机的人就只能眼看着一把用不了的钥匙一直挂在列表里。
 */
export default function PasskeyManager({
    base,
    className,
}: {
    /** `/auth/passkey`（主站）或 `/admin/auth/passkey`（后台）。 */
    base: string;
    className?: string;
}) {
    const [rows, setRows] = useState<PasskeyRow[]>([]);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const load = useCallback(async () => {
        setRows(await listPasskeys(base).catch(() => []));
    }, [base]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [supported, list] = await Promise.all([
                isAvailable(),
                listPasskeys(base).catch(() => []),
            ]);
            if (cancelled) return;
            setReady(supported);
            setRows(list);
        })();
        return () => { cancelled = true; };
    }, [base]);

    const add = async () => {
        setBusy(true);
        setNote(null);
        try {
            const created = await registerPasskey(base, guessDeviceLabel());
            setNote({ kind: 'ok', text: `已添加「${created.label}」` });
            await load();
        } catch (error) {
            setNote({ kind: 'error', text: explain(error) });
        } finally {
            setBusy(false);
        }
    };

    const remove = async (row: PasskeyRow) => {
        if (!window.confirm(`删掉「${row.label}」这把钥匙？之后这台设备要用密码登录。`)) return;
        await deletePasskey(base, row.id);
        await load();
    };

    return (
        <div className={className}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="m-0 flex items-center gap-1.5 text-sm text-ink">
                        <Fingerprint size={15} className="text-accent" />
                        用这台设备登录
                    </p>
                    <p className="mb-0 mt-0.5 text-xs leading-relaxed text-ink-muted">
                        加上之后就能用 Face ID 或指纹登录，不用打密码。
                        <strong className="text-ink"> 密码依然有效</strong>
                        ——手机丢了或换了设备，还得靠它进来。
                    </p>
                </div>
                {ready && (
                    <Button onClick={add} disabled={busy}>
                        <Plus size={15} />
                        {busy ? '等设备确认…' : '添加'}
                    </Button>
                )}
            </div>

            {note && (
                <p className={cn(
                    'm-0 mb-2 text-xs',
                    note.kind === 'ok' ? 'text-success' : 'text-danger',
                )}>
                    {note.text}
                </p>
            )}

            {!ready && (
                <p className="m-0 text-xs text-ink-muted">
                    这台设备不支持（需要 Face ID / 指纹 / Windows Hello 这类）。换手机试试。
                </p>
            )}

            {rows.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {rows.map(row => (
                        <li
                            key={row.id}
                            className="flex items-center gap-3 rounded-xl bg-sunken/40 px-3 py-2"
                        >
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                {row.label}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                                {row.lastUsedAt
                                    ? `用过 ${new Date(row.lastUsedAt).toLocaleDateString('zh-CN')}`
                                    : '还没用过'}
                            </span>
                            <button
                                type="button"
                                onClick={() => remove(row)}
                                aria-label={`删除 ${row.label}`}
                                className="shrink-0 rounded-lg p-1 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                                <Trash2 size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
