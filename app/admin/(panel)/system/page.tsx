'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-react';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { adminApi, type SettingDescriptor } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 系统配置。**整页是由后端的注册表渲染出来的，没有一个手写的表单项。**
 *
 * 设置项有四十个。逐个写控件的话，加一项要改前后端两处，而且类型和范围会在
 * 两边各写一遍、迟早对不上。现在后端 `runtime_config.REGISTRY` 声明类型、
 * 上下限、分组和说明，这里照着渲染、照着校验提示——加一项只改后端一行。
 *
 * ## 密钥是「只写」的
 *
 * 接口回传的是遮罩（`sk-ab••••3456`），不是明文。所以输入框**留空表示不改**，
 * 而不是清空——否则随便保存一次别的设置就会把所有密钥抹掉，而症状是模型调用
 * 突然 401，跟这次保存看起来毫无关系。
 */
export default function SystemConfigPage() {
    const [settings, setSettings] = useState<SettingDescriptor[]>([]);
    const [groups, setGroups] = useState<Record<string, string>>({});
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const payload = await adminApi.config().catch(() => null);
            if (cancelled || !payload) return;
            setSettings(payload.settings);
            setGroups(payload.groups);
        })();
        return () => { cancelled = true; };
    }, []);

    const grouped = useMemo(() => {
        const buckets = new Map<string, SettingDescriptor[]>();
        for (const item of settings) {
            const list = buckets.get(item.group) ?? [];
            list.push(item);
            buckets.set(item.group, list);
        }
        return [...buckets.entries()];
    }, [settings]);

    const dirty = Object.keys(draft).length > 0;

    const save = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const result = await adminApi.saveConfig(draft);
            setSettings(result.settings);
            setDraft({});
            setStatus({
                kind: 'ok',
                text: result.changed.length
                    ? `已保存 ${result.changed.length} 项`
                    : '没有变化',
            });
        } catch (error) {
            setStatus({ kind: 'error', text: error instanceof Error ? error.message : '保存失败' });
        } finally {
            setSaving(false);
        }
    };

    const resetOne = async (key: string) => {
        const result = await adminApi.resetConfig([key]);
        setSettings(result.settings);
        setDraft(current => {
            const next = { ...current };
            delete next[key];
            return next;
        });
        setStatus({ kind: 'ok', text: '已恢复为环境变量里的值' });
    };

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="m-0 font-display text-2xl text-ink">系统配置</h1>
                    <p className="mb-0 mt-1 text-sm text-ink-muted">
                        改完即时生效，最多滞后十秒。标着「需重启」的那几项要重启容器。
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {status && (
                        <span className={cn(
                            'text-sm',
                            status.kind === 'ok' ? 'text-success' : 'text-danger',
                        )}>
                            {status.text}
                        </span>
                    )}
                    <Button onClick={save} disabled={!dirty || saving}>
                        <Save size={16} />
                        {saving ? '保存中…' : dirty ? `保存 ${Object.keys(draft).length} 项` : '已保存'}
                    </Button>
                </div>
            </header>

            {grouped.map(([group, items]) => (
                <Card key={group} className="p-5">
                    <h2 className="m-0 mb-4 font-display text-lg text-ink">
                        {groups[group] ?? group}
                    </h2>
                    <div className="flex flex-col gap-5">
                        {items.map(item => (
                            <Field
                                key={item.key}
                                setting={item}
                                value={draft[item.key]}
                                onChange={next => setDraft(current => ({ ...current, [item.key]: next }))}
                                onReset={() => resetOne(item.key)}
                            />
                        ))}
                    </div>
                </Card>
            ))}
        </div>
    );
}

function Field({
    setting,
    value,
    onChange,
    onReset,
}: {
    setting: SettingDescriptor;
    value: string | undefined;
    onChange: (next: string) => void;
    onReset: () => void;
}) {
    const isSecret = setting.kind === 'secret';
    // 密钥的当前值是遮罩，不能当输入框的值——那样一保存就把遮罩写进去了。
    const shown = value ?? (isSecret ? '' : String(setting.value ?? ''));

    return (
        <div className="grid gap-2 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-start md:gap-4">
            <div>
                <label htmlFor={setting.key} className="block text-sm font-medium text-ink">
                    {setting.label}
                </label>
                <p className="m-0 mt-0.5 font-mono text-[11px] text-ink-muted/70">{setting.key}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    {setting.overridden && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:text-accent"
                            title="删掉后台的覆盖，回到 .env 里的值"
                        >
                            <RotateCcw size={11} />
                            已覆盖
                        </button>
                    )}
                    {setting.restartRequired && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
                            <AlertTriangle size={11} />
                            需重启
                        </span>
                    )}
                </div>
            </div>

            <div>
                {setting.kind === 'choice' || setting.kind === 'bool' ? (
                    <select
                        id={setting.key}
                        value={shown}
                        onChange={event => onChange(event.target.value)}
                        className="w-full rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm text-ink"
                    >
                        {setting.kind === 'bool' ? (
                            <>
                                <option value="true">开启</option>
                                <option value="false">关闭</option>
                            </>
                        ) : setting.choices.map(choice => (
                            <option key={choice} value={choice}>{choice}</option>
                        ))}
                    </select>
                ) : (
                    <Input
                        id={setting.key}
                        type={isSecret ? 'password' : setting.kind === 'int' || setting.kind === 'float' ? 'number' : 'text'}
                        inputMode={setting.kind === 'int' ? 'numeric' : undefined}
                        step={setting.kind === 'float' ? 'any' : undefined}
                        min={setting.minimum ?? undefined}
                        max={setting.maximum ?? undefined}
                        value={shown}
                        placeholder={isSecret ? (setting.value ? String(setting.value) : '未配置') : undefined}
                        onChange={event => onChange(event.target.value)}
                    />
                )}

                {(setting.help || setting.minimum !== null) && (
                    <p className="mb-0 mt-1.5 text-xs leading-relaxed text-ink-muted">
                        {setting.help}
                        {setting.minimum !== null && setting.maximum !== null && (
                            <span className="ml-1 whitespace-nowrap opacity-70">
                                （{setting.minimum} – {setting.maximum}）
                            </span>
                        )}
                        {isSecret && (
                            <span className="ml-1 text-ink-muted/80">
                                留空表示不改。
                            </span>
                        )}
                    </p>
                )}
                {value !== undefined && (
                    <p className="mb-0 mt-1 flex items-center gap-1 text-xs text-accent">
                        <Check size={12} />
                        待保存
                    </p>
                )}
            </div>
        </div>
    );
}
