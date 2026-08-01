'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { adminApi, type SettingDescriptor } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 首页素材。
 *
 * 在这之前那段视频和那张静态图是 `public/hero/*` 里的文件，**烤进 Docker 镜像**
 * ——换一张要改代码、重新构建、重新部署。现在传上来就生效。
 *
 * 没上传过时用镜像里自带的那份兜底，所以这一页是空的也不会让首页开天窗。
 */

const SLOTS = [
    {
        slot: 'video' as const,
        title: '首页视频',
        configKey: 'site.hero_video_attachment',
        accept: 'video/mp4,video/webm',
        hint: '建议 900×900 左右、5–8 秒、能首尾衔接的循环。太大的话首屏会等很久。',
    },
    {
        slot: 'poster' as const,
        title: '静态图',
        configKey: 'site.hero_poster_attachment',
        accept: 'image/webp,image/png,image/jpeg',
        hint: '关掉动效的人看到的就是这张，也是视频加载前的占位。取视频第一帧最自然。',
    },
];

export default function HeroPage() {
    const [settings, setSettings] = useState<SettingDescriptor[]>([]);
    const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        setSettings((await adminApi.config()).settings);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const payload = await adminApi.config().catch(() => null);
            if (!cancelled && payload) setSettings(payload.settings);
        })();
        return () => { cancelled = true; };
    }, []);

    const valueOf = (key: string) =>
        String(settings.find(item => item.key === key)?.value ?? '');

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="m-0 font-display text-2xl text-ink">首页素材</h1>
                    <p className="mb-0 mt-1 text-sm text-ink-muted">
                        传上来即时生效，不用重新部署。
                    </p>
                </div>
                {note && (
                    <span className={cn('text-sm', note.kind === 'ok' ? 'text-success' : 'text-danger')}>
                        {note.text}
                    </span>
                )}
            </header>

            {SLOTS.map(config => (
                <SlotCard
                    key={config.slot}
                    {...config}
                    current={valueOf(config.configKey)}
                    busy={busy === config.slot}
                    onBusy={setBusy}
                    onDone={async (text, kind) => {
                        setNote({ kind, text });
                        await load();
                    }}
                />
            ))}
        </div>
    );
}

function SlotCard({
    slot, title, accept, hint, current, busy, onBusy, onDone,
}: {
    slot: 'video' | 'poster';
    title: string;
    accept: string;
    hint: string;
    current: string;
    busy: boolean;
    onBusy: (slot: string) => void;
    onDone: (text: string, kind: 'ok' | 'error') => Promise<void>;
}) {
    const input = useRef<HTMLInputElement>(null);

    const upload = async (file: File) => {
        onBusy(slot);
        try {
            const result = await adminApi.uploadHero(slot, file);
            await onDone(`${title}已更新（${Math.round(result.size / 1024)} KB）`, 'ok');
        } catch (error) {
            await onDone(error instanceof Error ? error.message : '上传失败', 'error');
        } finally {
            onBusy('');
        }
    };

    return (
        <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="m-0 font-display text-lg text-ink">{title}</h2>
                    <p className="mb-0 mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>
                    <p className="mb-0 mt-2 text-xs">
                        当前：
                        {current ? (
                            <span className="font-mono text-ink">{current}</span>
                        ) : (
                            <span className="text-ink-muted">镜像自带的那份</span>
                        )}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <input
                        ref={input}
                        type="file"
                        accept={accept}
                        className="hidden"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) void upload(file);
                            event.target.value = '';
                        }}
                    />
                    <Button onClick={() => input.current?.click()} disabled={busy}>
                        <Upload size={15} />
                        {busy ? '上传中…' : '换一个'}
                    </Button>
                    {current && (
                        <button
                            type="button"
                            onClick={async () => {
                                await adminApi.resetHero(slot);
                                await onDone(`${title}已恢复为镜像自带`, 'ok');
                            }}
                            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                        >
                            <RotateCcw size={15} />
                            恢复默认
                        </button>
                    )}
                </div>
            </div>
        </Card>
    );
}
