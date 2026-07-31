'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, Plus, Trash2, X } from 'lucide-react';
import Card from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { mapPinsApi, type MapPin } from '@/lib/api/mapPins';
import PlaceSearchBox, { type PickedPlace } from './PlaceSearchBox';

/**
 * 恋爱地图（计划文档 §2.5）。
 *
 * 左右结构：地图占左边一大块，右边一栏放搜索、正在记的点和已有的点。上下结构
 * 的问题是地图一高，下面的列表就整个掉到屏幕外，标完一个点还得滚回去看。
 * 窄屏放不下两栏，退回上下——手机上并排两栏谁都用不了。
 *
 * 坐标是 GCJ-02（高德原生），前后端都不转换。
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

interface Draft {
    lat: number;
    lng: number;
    /** 搜索选中带过来的名字，手动点地图时为空 */
    title?: string;
    address?: string;
}

export default function MapPage() {
    const [pins, setPins] = useState<MapPin[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [title, setTitle] = useState('');
    const [note, setNote] = useState('');
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);
    const [selected, setSelected] = useState<MapPin | null>(null);
    const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
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
        setTitle('');
    }, []);

    const select = useCallback((pin: MapPin) => {
        setDraft(null);
        setSelected(pin);
        setFocus({ lng: pin.lng, lat: pin.lat, nonce: Date.now() });
    }, []);

    /** 搜索选中：把地图飞过去，并把名字填好当成待记的点。 */
    const pickFromSearch = useCallback((place: PickedPlace) => {
        setSelected(null);
        setDraft({ lat: place.lat, lng: place.lng, title: place.name, address: place.address });
        setTitle(place.name);
        setFocus({ lng: place.lng, lat: place.lat, nonce: Date.now() });
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
        <div className="mx-auto max-w-7xl px-4 py-6">
            <header className="mb-6 pt-2 animate-fade-up">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.4em] text-accent">
                    Places We&apos;ve Been
                </p>
                <h1 className="m-0 mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide">
                    <span className="text-ink">恋爱</span>
                    <span className="text-stroke-accent">地图</span>
                </h1>
                <p className="mb-0 mt-4 text-sm text-ink-muted md:text-base">
                    搜一个地方，或者直接在地图上点一下。
                </p>
            </header>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                {/* 地图上的点击是「在这儿加个点」，不是「宠物过来」。没有这个属性
                    每标一个地方宠物都要横穿屏幕走过来（见 usePetInteraction 的
                    WALK_EXCLUSION）。 */}
                <Card
                    className="overflow-hidden p-0 lg:flex-1"
                    data-no-pet-walk
                >
                    <AmapCanvas
                        pins={pins}
                        onPickLocation={pick}
                        onSelectPin={select}
                        focus={focus}
                        className="h-[46vh] w-full lg:h-[calc(100vh-14rem)] lg:min-h-[460px]"
                    />
                </Card>

                <aside className="flex w-full flex-col gap-4 lg:w-[340px] lg:shrink-0">
                    <PlaceSearchBox onPick={pickFromSearch} />

                    {draft && (
                        <Card className="p-4">
                            <form onSubmit={save}>
                                <div className="mb-3 flex items-center gap-1.5 text-xs text-ink-muted">
                                    <MapPinned size={13} className="text-accent" />
                                    <span className="truncate">
                                        {draft.address || `${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)}`}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setDraft(null)}
                                        aria-label="取消"
                                        className="ml-auto shrink-0 cursor-pointer hover:text-ink"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                                <Input
                                    type="text"
                                    value={title}
                                    onChange={event => setTitle(event.target.value)}
                                    placeholder="这是哪儿…"
                                    aria-label="地点名称"
                                    autoFocus
                                />
                                <Input
                                    type="text"
                                    value={note}
                                    onChange={event => setNote(event.target.value)}
                                    placeholder="想记一句也可以（可留空）"
                                    aria-label="备注"
                                    className="mt-2.5"
                                />
                                <div className="mt-2.5 flex gap-2">
                                    <Input
                                        type="date"
                                        value={date}
                                        onChange={event => setDate(event.target.value)}
                                        aria-label="去的日期（可留空）"
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
                            </form>
                        </Card>
                    )}

                    {selected && (
                        <Card className="p-4">
                            <div className="flex items-start gap-2.5">
                                <span className="text-xl" aria-hidden>📍</span>
                                <div className="min-w-0 flex-1">
                                    <h2 className="m-0 font-display text-base font-semibold tracking-wide text-ink">
                                        {selected.title}
                                    </h2>
                                    {selected.date && (
                                        <p className="m-0 mt-0.5 text-xs text-ink-muted">
                                            {selected.date}
                                        </p>
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
                                    <Trash2 size={15} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelected(null)}
                                    aria-label="收起"
                                    className="shrink-0 cursor-pointer text-ink-muted/60 transition-colors hover:text-ink"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </Card>
                    )}

                    <Card className="flex min-h-0 flex-col p-4">
                        <h2 className="m-0 mb-3 flex items-center gap-2 font-display text-base font-semibold tracking-wide text-ink">
                            去过的地方
                            <span className="ml-auto text-xs font-normal tabular-nums text-ink-muted">
                                {pins.length}
                            </span>
                        </h2>
                        {loading ? (
                            <p className="m-0 py-6 text-center text-sm text-ink-muted">加载中...</p>
                        ) : pins.length === 0 ? (
                            <EmptyState
                                icon="🗺️"
                                title="还没有点"
                                hint="搜一个地方，或在地图上点一下"
                                className="py-6"
                            />
                        ) : (
                            <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto lg:max-h-[38vh]">
                                {pins.map(pin => (
                                    <button
                                        key={pin.id}
                                        type="button"
                                        onClick={() => select(pin)}
                                        aria-current={selected?.id === pin.id ? 'true' : undefined}
                                        className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
                                            selected?.id === pin.id
                                                ? 'bg-accent-soft'
                                                : 'bg-sunken/60 hover:bg-sunken'
                                        }`}
                                    >
                                        <span aria-hidden>📍</span>
                                        <span className="flex-1 truncate text-sm text-ink">
                                            {pin.title}
                                        </span>
                                        {pin.date && (
                                            <span className="shrink-0 text-xs text-ink-muted">
                                                {pin.date}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
                </aside>
            </div>
        </div>
    );
}
