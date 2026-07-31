'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, Plus, Trash2, X } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { mapPinsApi, type MapPin } from '@/lib/api/mapPins';

/**
 * 恋爱地图（计划文档 §2.5）。
 *
 * 去过的地方打点。坐标是 GCJ-02（高德原生），前后端都不转换。
 *
 * 加点的方式刻意是「在地图上点一下」而不是填经纬度输入框——没人记得自己家的
 * 坐标是多少。
 */

// 高德的 JS API 只能在浏览器里跑，SSR 阶段没有 window
const AmapCanvas = dynamic(() => import('./AmapCanvas'), {
    ssr: false,
    loading: () => (
        <div className="grid h-full place-items-center text-sm text-ink-muted">
            地图加载中…
        </div>
    ),
});

export default function MapPage() {
    const [pins, setPins] = useState<MapPin[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
    const [title, setTitle] = useState('');
    const [note, setNote] = useState('');
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);
    const [selected, setSelected] = useState<MapPin | null>(null);
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setPins(await mapPinsApi.list());
        } catch {
            toast('地图上的点读不出来', 'error');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
    }, [load]);

    const pick = useCallback((coords: { lat: number; lng: number }) => {
        setSelected(null);
        setDraft(coords);
    }, []);

    const select = useCallback((pin: MapPin) => {
        setDraft(null);
        setSelected(pin);
    }, []);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        const text = title.trim();
        if (!text || !draft || saving) return;
        setSaving(true);
        try {
            const created = await mapPinsApi.create({
                title: text,
                lat: draft.lat,
                lng: draft.lng,
                note: note.trim() || null,
                date: date || null,
            });
            setPins(current => [...current, created]);
            setDraft(null);
            setTitle('');
            setNote('');
            setDate('');
        } catch (reason) {
            toast(reason instanceof Error ? reason.message : '存不下来', 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (pin: MapPin) => {
        const previous = pins;
        setPins(current => current.filter(item => item.id !== pin.id));
        setSelected(null);
        try {
            await mapPinsApi.remove(pin.id);
        } catch {
            setPins(previous);
            toast('删不掉，再试一次', 'error');
        }
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-6">
            <header className="mb-6 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Places We&apos;ve Been
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">恋爱</span>
                    <span className="text-stroke-accent">地图</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    在地图上点一下，把去过的地方记下来。
                </p>
            </header>

            {/* 地图上的点击是「在这儿加个点」，不是「宠物过来」。没有这个属性的话
                每标一个地方宠物都要横穿屏幕走过来（见 usePetInteraction 的
                WALK_EXCLUSION）。 */}
            <Card className="mb-5 overflow-hidden p-0" data-no-pet-walk>
                <AmapCanvas
                    pins={pins}
                    onPickLocation={pick}
                    onSelectPin={select}
                    className="h-[380px] w-full md:h-[460px]"
                />
            </Card>

            {draft && (
                <Card className="mb-5 p-5">
                    <form onSubmit={save}>
                        <div className="mb-3 flex items-center gap-1.5 text-xs text-ink-muted">
                            <MapPinned size={13} className="text-accent" />
                            {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
                            <button
                                type="button"
                                onClick={() => setDraft(null)}
                                aria-label="取消"
                                className="ml-auto cursor-pointer hover:text-ink"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <Input
                                type="text"
                                value={title}
                                onChange={event => setTitle(event.target.value)}
                                placeholder="这是哪儿…"
                                aria-label="地点名称"
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <Input
                                    type="date"
                                    value={date}
                                    onChange={event => setDate(event.target.value)}
                                    aria-label="去的日期（可留空）"
                                    className="sm:w-44"
                                />
                                <button
                                    type="submit"
                                    disabled={!title.trim() || saving}
                                    aria-label="保存这个地点"
                                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-soft transition-all hover:bg-accent-strong active:scale-95 disabled:opacity-50"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>
                        <Input
                            type="text"
                            value={note}
                            onChange={event => setNote(event.target.value)}
                            placeholder="想记一句也可以（可留空）"
                            aria-label="备注"
                            className="mt-3"
                        />
                    </form>
                </Card>
            )}

            {selected && (
                <Card className="mb-5 p-5">
                    <div className="flex items-start gap-3">
                        <span className="text-xl" aria-hidden>📍</span>
                        <div className="min-w-0 flex-1">
                            <h2 className="m-0 font-display text-lg font-semibold tracking-wide text-ink">
                                {selected.title}
                            </h2>
                            {selected.date && (
                                <p className="m-0 mt-0.5 text-xs text-ink-muted">{selected.date}</p>
                            )}
                            {selected.note && (
                                <p className="mb-0 mt-2 text-sm leading-relaxed text-ink">
                                    {selected.note}
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => void remove(selected)}
                            aria-label={`删除 ${selected.title}`}
                            className="shrink-0 cursor-pointer text-ink-muted/60 transition-colors hover:text-danger"
                        >
                            <Trash2 size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelected(null)}
                            aria-label="收起"
                            className="shrink-0 cursor-pointer text-ink-muted/60 transition-colors hover:text-ink"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </Card>
            )}

            {loading ? (
                <p className="py-6 text-center text-ink-muted">加载中...</p>
            ) : pins.length === 0 ? (
                <EmptyState
                    icon="🗺️"
                    title="还没有点"
                    hint="在上面的地图上点一下，就能记下第一个地方"
                />
            ) : (
                <div className="flex flex-col gap-2">
                    <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-ink">
                        去过的地方
                        <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                            {pins.length}
                        </span>
                    </h2>
                    {pins.map(pin => (
                        <button
                            key={pin.id}
                            type="button"
                            onClick={() => select(pin)}
                            className="flex cursor-pointer items-center gap-3 rounded-md bg-sunken/60 px-3 py-2.5 text-left transition-colors hover:bg-sunken"
                        >
                            <span aria-hidden>📍</span>
                            <span className="flex-1 truncate text-sm text-ink">{pin.title}</span>
                            {pin.date && (
                                <span className="shrink-0 text-xs text-ink-muted">{pin.date}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
