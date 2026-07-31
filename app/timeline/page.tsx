"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Calendar, Heart, List, MapPin as MapPinIcon, Map as MapIcon, Plus, X } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import PlaceSearchBox, { type PickedPlace } from '../components/amap/PlaceSearchBox';
import { hasPlace, milestonesApi, type Milestone } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

/**
 * 我们的故事。
 *
 * 「故事」和「地图」原本是两张表两个页面，但它们本来就是同一件事的两种看法
 * ——发生过的事，有时间，**有时候**还有地点。分成两处的代价是：一次旅行要记
 * 两遍，而且两边都不完整（没地点的事进不了地图，有地点的事在时间轴上又看不到
 * 它在哪）。
 *
 * 现在是一批数据两个视图：时间轴看全部，地图只画有坐标的那些。
 */

const AmapCanvas = dynamic(() => import('../components/amap/AmapCanvas'), {
    ssr: false,
    loading: () => (
        <div className="grid h-full place-items-center text-sm text-ink-muted">
            地图加载中…
        </div>
    ),
});

type View = 'timeline' | 'map';

interface Draft {
    title: string;
    date: string;
    description: string;
    lat: number | null;
    lng: number | null;
    /** 搜索选中时带过来的地址，仅用于表单里显示 */
    address?: string;
}

const EMPTY_DRAFT: Draft = {
    title: '',
    date: '',
    description: '',
    lat: null,
    lng: null,
};

export default function Timeline() {
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [submitting, setSubmitting] = useState(false);
    const [view, setView] = useState<View>('timeline');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
    const { toast } = useToast();

    const loadMilestones = useCallback(async () => {
        try {
            const data = await milestonesApi.list();
            setMilestones([...data].sort((a, b) => a.date.localeCompare(b.date)));
        } catch (error) {
            console.error('Failed to fetch milestones', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMilestones();
    }, [loadMilestones]);
    useResourceEvents(['milestones'], () => void loadMilestones());

    const placed = useMemo(() => milestones.filter(hasPlace), [milestones]);
    const selected = useMemo(
        () => milestones.find(item => item.id === selectedId) ?? null,
        [milestones, selectedId],
    );

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft.title || !draft.date) {
            toast('请填写标题和日期', 'error');
            return;
        }
        setSubmitting(true);
        try {
            const added = await milestonesApi.create({
                title: draft.title,
                date: draft.date,
                description: draft.description,
                lat: draft.lat,
                lng: draft.lng,
            });
            setMilestones(prev =>
                [...prev, added].sort((a, b) => a.date.localeCompare(b.date)));
            setDraft(EMPTY_DRAFT);
            setShowForm(false);
            toast('故事已记录 ⭐');
        } catch (error) {
            toast(error instanceof Error ? error.message : '添加失败，请重试', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const pickPlace = useCallback((place: PickedPlace) => {
        setDraft(current => ({
            ...current,
            lat: place.lat,
            lng: place.lng,
            address: place.address,
            // 还没写标题的话，用地名当默认——多数时候那就是想记的名字
            title: current.title || place.name,
        }));
        setFocus({ lng: place.lng, lat: place.lat, nonce: Date.now() });
    }, []);

    const selectOnMap = useCallback((item: { id: string; lat: number; lng: number }) => {
        setSelectedId(item.id);
        setFocus({ lng: item.lng, lat: item.lat, nonce: Date.now() });
    }, []);

    return (
        <div className="mx-auto max-w-4xl px-4 py-6">
            <header className="mb-6 pt-2 animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-accent m-0">
                    Our Story
                </p>
                <h1 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide m-0">
                    <span className="text-ink">我们的</span>
                    <span className="text-stroke-accent">故事</span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-ink-muted mb-0">
                    一路走来，风景是你
                </p>
            </header>

            <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
                {/* 视图切换。地图那一档标出有地点的条数——不然用户会以为地图坏了，
                    其实只是记的事都还没填地点。 */}
                <div className="flex items-center gap-1 rounded-full bg-sunken/70 p-1" role="group" aria-label="视图">
                    <button
                        type="button"
                        onClick={() => setView('timeline')}
                        aria-pressed={view === 'timeline'}
                        className={cn(
                            'flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors',
                            view === 'timeline' ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted'
                        )}
                    >
                        <List size={15} /> 时间轴
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('map')}
                        aria-pressed={view === 'map'}
                        className={cn(
                            'flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors',
                            view === 'map' ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted'
                        )}
                    >
                        <MapIcon size={15} /> 地图
                        {placed.length > 0 && (
                            <span className="tabular-nums text-xs text-ink-muted">{placed.length}</span>
                        )}
                    </button>
                </div>
                <Button onClick={() => setShowForm(!showForm)}>
                    <Plus size={16} />
                    {showForm ? '取消' : '记录新的故事'}
                </Button>
            </div>

            {showForm && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-8 overflow-hidden"
                >
                    <Card className="p-6 md:p-8">
                        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                            <input
                                id="ms-title"
                                type="text"
                                value={draft.title}
                                onChange={event => setDraft({ ...draft, title: event.target.value })}
                                placeholder="给这一天起个名字"
                                aria-label="标题"
                                required
                                className="w-full border-0 border-b-2 border-sunken bg-transparent px-0 pb-3 font-display text-2xl md:text-3xl font-semibold tracking-wide text-ink placeholder:text-ink-muted/50 outline-none transition-colors focus:border-accent"
                            />
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="min-w-[170px]">
                                    <label htmlFor="ms-date" className="mb-1.5 flex items-center gap-1 text-sm text-ink-muted">
                                        <Calendar size={14} /> 日期 *
                                    </label>
                                    <Input
                                        id="ms-date"
                                        type="date"
                                        value={draft.date}
                                        onChange={event => setDraft({ ...draft, date: event.target.value })}
                                        required
                                    />
                                </div>
                                <div className="flex-1 min-w-[220px]">
                                    <label htmlFor="ms-desc" className="block mb-1.5 text-sm text-ink-muted">描述</label>
                                    <Textarea
                                        id="ms-desc"
                                        value={draft.description}
                                        onChange={event => setDraft({ ...draft, description: event.target.value })}
                                        placeholder="那天阳光很好..."
                                        rows={2}
                                    />
                                </div>
                            </div>

                            {/* 地点是**可选的**——不是每件值得记的事都发生在某个地方。 */}
                            <div>
                                <label className="mb-1.5 flex items-center gap-1 text-sm text-ink-muted">
                                    <MapPinIcon size={14} /> 地点（可留空）
                                </label>
                                {draft.lat !== null && draft.lng !== null ? (
                                    <div className="flex items-center gap-2 rounded-md bg-sunken/60 px-3 py-2 text-sm text-ink">
                                        <MapPinIcon size={14} className="shrink-0 text-accent" />
                                        <span className="min-w-0 flex-1 truncate">
                                            {draft.address || `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setDraft({ ...draft, lat: null, lng: null, address: undefined })}
                                            aria-label="去掉地点"
                                            className="shrink-0 cursor-pointer text-ink-muted hover:text-ink"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <PlaceSearchBox onPick={pickPlace} />
                                )}
                            </div>

                            <Button type="submit" disabled={submitting} className="self-start">
                                {submitting ? '保存中...' : (
                                    <>
                                        <Heart size={16} /> 添加到故事
                                    </>
                                )}
                            </Button>
                        </form>
                    </Card>
                </motion.div>
            )}

            {loading ? (
                <p className="text-center text-ink-muted py-8">加载故事中...</p>
            ) : milestones.length === 0 ? (
                <EmptyState icon="⭐" title="还没有记录故事" hint="点击上方按钮添加吧" />
            ) : view === 'map' ? (
                <div className="flex flex-col gap-4">
                    <Card className="overflow-hidden p-0" data-no-pet-walk>
                        <AmapCanvas
                            pins={placed}
                            onSelectPin={selectOnMap}
                            focus={focus}
                            className="h-[52vh] w-full min-h-[360px]"
                        />
                    </Card>
                    {selected && hasPlace(selected) && (
                        <Card className="p-5">
                            <div className="flex items-start gap-3">
                                <span aria-hidden>📍</span>
                                <div className="min-w-0 flex-1">
                                    <div className="font-display text-lg font-semibold tracking-wide text-accent">
                                        {selected.date}
                                    </div>
                                    <h3 className="m-0 mt-1 font-display text-xl font-semibold tracking-wide text-ink">
                                        {selected.title}
                                    </h3>
                                    {selected.description && (
                                        <p className="mb-0 mt-2 text-sm leading-loose text-ink-muted">
                                            {selected.description}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(null)}
                                    aria-label="收起"
                                    className="shrink-0 cursor-pointer text-ink-muted/60 hover:text-ink"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </Card>
                    )}
                    {placed.length === 0 && (
                        <EmptyState
                            icon="🗺️"
                            title="还没有带地点的故事"
                            hint="记录故事时搜一个地方，它就会出现在这儿"
                        />
                    )}
                </div>
            ) : (
                <div className="relative">
                    <div
                        className="absolute top-0 bottom-0 w-0.5 left-4 md:left-1/2 md:-translate-x-1/2 rounded-full bg-gradient-to-b from-accent/10 via-accent/50 to-accent/10"
                        aria-hidden
                    />
                    <div className="flex flex-col gap-8">
                        {milestones.map((item, index) => {
                            const isLeft = index % 2 === 0;
                            return (
                                <div
                                    key={item.id}
                                    className={cn(
                                        'timeline-reveal relative pl-12 md:pl-0 md:w-1/2',
                                        isLeft ? 'md:pr-12' : 'md:pl-12 md:ml-auto'
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'absolute top-5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-accent bg-surface shadow-soft',
                                            'left-0 md:left-auto',
                                            isLeft
                                                ? 'md:right-0 md:translate-x-1/2'
                                                : 'md:left-0 md:-translate-x-1/2'
                                        )}
                                        aria-hidden
                                    >
                                        <Heart size={14} className="text-accent" fill="currentColor" />
                                    </div>
                                    <Card className={cn(
                                        'p-5 transition-all duration-300 ease-spring hover:shadow-lift hover:rotate-0 hover:-translate-y-0.5',
                                        isLeft ? 'md:rotate-[0.6deg]' : 'md:-rotate-[0.6deg]'
                                    )}>
                                        <div className="font-display text-2xl font-semibold tracking-wide text-accent">
                                            {item.date}
                                        </div>
                                        <h3 className="mt-2 font-display text-xl font-semibold tracking-wide text-ink mb-0">
                                            {item.title}
                                        </h3>
                                        {item.description && (
                                            <p className="mt-2 text-sm leading-loose text-ink-muted mb-0">
                                                {item.description}
                                            </p>
                                        )}
                                        {hasPlace(item) && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setView('map');
                                                    selectOnMap(item);
                                                }}
                                                className="mt-3 flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
                                            >
                                                <MapPinIcon size={12} /> 在地图上看
                                            </button>
                                        )}
                                    </Card>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
