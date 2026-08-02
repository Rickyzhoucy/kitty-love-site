'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Monitor, PawPrint, Power, Ruler } from 'lucide-react';
import { isTauriDesktop } from '@/lib/desktop';
import {
    DEFAULT_DESKTOP_SETTINGS,
    PET_WINDOW_SIZES,
    type DesktopSettings,
} from '@/lib/desktopPet';
import { cn } from '@/lib/utils';

/**
 * 桌面版专属设置。**只在 Tauri 里出现**，浏览器里整块不渲染。
 *
 * 这些是「这台电脑上的偏好」，存在本机的配置文件里，不进服务端 —— 换台电脑
 * 就该是另一份。你在公司把宠物锁了，不该让她家里那只也跟着不动。
 */
export default function DesktopSettingsPanel() {
    const [available, setAvailable] = useState(false);
    const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isTauriDesktop()) return;
        let cancelled = false;
        void (async () => {
            const { invoke } = await import('@tauri-apps/api/core');
            const loaded = await invoke<DesktopSettings>('get_desktop_settings');
            if (cancelled) return;
            setSettings(loaded);
            setAvailable(true);
        })();
        return () => { cancelled = true; };
    }, []);

    const patch = useCallback(async (changes: Partial<DesktopSettings>) => {
        setBusy(true);
        const next = { ...settings, ...changes };
        // 先落到界面上再等后端 —— 开关这种东西，等一个往返再动会显得很迟钝。
        setSettings(next);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('update_desktop_settings', { next });
        } catch (error) {
            console.error('Failed to update desktop settings', error);
            setSettings(settings); // 失败就退回去，别让界面撒谎
        } finally {
            setBusy(false);
        }
    }, [settings]);

    if (!available) return null;

    return (
        <div className="flex flex-col gap-1">
            <p className="m-0 mb-2 flex items-center gap-1.5 text-sm text-ink">
                <Monitor size={15} className="text-accent" />
                桌面版
            </p>

            <Toggle
                icon={Lock}
                label="锁定宠物"
                hint="鼠标穿透，宠物变成纯装饰 —— 点不到也拖不动，但也绝不会挡住你点桌面。"
                checked={settings.locked}
                disabled={busy}
                onChange={locked => void patch({ locked })}
            />
            <Toggle
                icon={PawPrint}
                label="显示宠物"
                hint="关掉之后宠物窗口收起来，主界面照常用。"
                checked={settings.petVisible}
                disabled={busy}
                onChange={petVisible => void patch({ petVisible })}
            />
            <Toggle
                icon={Monitor}
                label="宠物始终置顶"
                hint="关掉之后它会被其他窗口盖住。"
                checked={settings.alwaysOnTop}
                disabled={busy}
                onChange={alwaysOnTop => void patch({ alwaysOnTop })}
            />
            <Toggle
                icon={Power}
                label="开机自动启动"
                hint="登录之后自动把宠物放到桌面上。"
                checked={settings.autostart}
                disabled={busy}
                onChange={autostart => void patch({ autostart })}
            />

            <div className="mt-2 border-t border-sunken pt-3">
                <p className="m-0 mb-1.5 flex items-center gap-1.5 text-sm text-ink">
                    <Ruler size={15} className="text-accent" />
                    宠物大小
                </p>
                <div className="flex gap-2">
                    {PET_WINDOW_SIZES.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void patch({ petSize: option.px })}
                            className={cn(
                                'h-9 flex-1 cursor-pointer rounded-full border transition-all',
                                settings.petSize === option.px
                                    ? 'border-accent bg-accent font-medium text-on-accent shadow-soft'
                                    : 'border-sunken bg-surface text-ink-muted hover:border-accent/40',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <p className="mb-0 mt-3 text-xs leading-relaxed text-ink-muted">
                关掉主界面只是把它收进托盘，
                <strong className="text-ink">宠物会留在桌面上</strong>
                。要完全退出，用托盘菜单里的「退出」。
            </p>
        </div>
    );
}

function Toggle({
    icon: Icon,
    label,
    hint,
    checked,
    disabled,
    onChange,
}: {
    icon: typeof Lock;
    label: string;
    hint: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-2 transition-colors hover:bg-sunken/40">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm text-ink">
                    <Icon size={14} className="text-ink-muted" />
                    {label}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>
            </span>
        </label>
    );
}
