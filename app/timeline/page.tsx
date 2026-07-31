"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Calendar, Heart, MapPin as MapPinIcon, Plus, X } from 'lucide-react';
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
 * 「故事」和「地图」原本是两张表两个页面，后来并成了一个页面的两个视图——但
 * **视图切换是错的**：这两样东西的价值恰恰在于同时看见。「去年三月那趟旅行」
 * 和「地图上那个点」是同一件事，隔着一次点击就对不上了。
 *
 * 所以现在是左右两栏，同一份数据两种排法：左边按时间读，右边按位置看，选中
 * 状态两边共享。点左边的条目地图飞过去并让那个点跳一下；点地图上的点左边滚到
 * 对应那条并高亮。
 *
 * 窄屏放不下并排，改成地图吸顶 + 列表在下面滚——**仍然是同时可见的**，
 * 这才是重点，左右只是宽屏上实现它的方式。
 */

const AmapCanvas = dynamic(() => import('../components/amap/AmapCanvas'), {
    ssr: false,
    loading: () => (
        <div className="grid h-full place-items-center text-sm text-ink-muted">
            地图加载中…
        </div>
    ),
});

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
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
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

    /** 左边点了一条：地图飞过去。 */
    const selectFromList = useCallback((item: Milestone) => {
        setSelectedId(item.id);
        if (hasPlace(item)) {
            setFocus({ lng: item.lng, lat: item.lat, nonce: Date.now() });
        }
    }, []);

    /** 右边点了一个点：左边滚到对应那条。 */
    const selectFromMap = useCallback((pin: { id: string; lat: number; lng: number }) => {
        setSelectedId(pin.id);
        setFocus({ lng: pin.lng, lat: pin.lat, nonce: Date.now() });
        itemRefs.current.get(pin.id)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }, []);

    return (
        <div className="mx-auto max-w-7xl px-4 py-6">
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

            <div className="mb-5">
                <Button onClick={() => setShowForm(!showForm)}>
                    <Plus size={16} />
                    {showForm ? '取消' : '记录新的故事'}
                </Button>
            </div>

            {showForm && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-6 overflow-hidden"
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
                                className="w-full border-0 border-b-2 border-sunken bg-transparent px-0 pb-3 font-display text-2xl md:text-3xl font-semibold tracking-wide text-ink placeholder:text-ink-muted/70 outline-none transition-colors focus:border-accent"
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
            ) : (
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                    {/* 地图。窄屏吸顶、宽屏吸在右侧——两种情况下它都必须**留在视野里**，
                        否则左右分栏就退化回了「翻到另一页去看」。 */}
                    <div className="sticky top-0 z-10 order-1 -mx-4 px-4 pb-3 pt-1 lg:order-2 lg:top-4 lg:mx-0 lg:px-0 lg:pb-0 lg:pt-0">
                        <Card className="overflow-hidden p-0" data-no-pet-walk>
                            <AmapCanvas
                                pins={placed}
                                onSelectPin={selectFromMap}
                                focus={focus}
                                selectedId={selectedId}
                                className="h-[34vh] w-full lg:h-[calc(100vh-11rem)] lg:min-h-[420px]"
                            />
                        </Card>
                        {placed.length === 0 && (
                            <p className="mt-2 mb-0 text-center text-xs text-ink-muted">
                                还没有带地点的故事——记录时搜一个地方，它就会出现在这儿。
                            </p>
                        )}
                    </div>

                    {/* 故事列表。一列而不是原来左右交错的时间轴：交错版在半幅宽度里
                        每张卡只剩一半可读宽度，而它换来的对称感在这儿没有用武之地。 */}
                    <ol className="order-2 m-0 grid list-none gap-3 p-0 lg:order-1">
                        {milestones.map(item => {
                            const placedItem = hasPlace(item);
                            const active = item.id === selectedId;
                            const body = (
                                <>
                                    <div className="flex items-baseline gap-2">
                                        <span className="font-display text-lg font-semibold tracking-wide text-accent">
                                            {item.date}
                                        </span>
                                        {placedItem && (
                                            <MapPinIcon
                                                size={13}
                                                aria-label="有地点"
                                                className="shrink-0 translate-y-px text-accent"
                                            />
                                        )}
                                    </div>
                                    <h3 className="mt-1 mb-0 font-display text-xl font-semibold tracking-wide text-ink">
                                        {item.title}
                                    </h3>
                                    {item.description && (
                                        <p className="mt-2 mb-0 text-sm leading-relaxed text-ink-muted">
                                            {item.description}
                                        </p>
                                    )}
                                </>
                            );
                            return (
                                <li
                                    key={item.id}
                                    // 大括号里不能写成表达式体：React 19 把 ref
                                    // 回调的返回值当成 cleanup 函数，而 Map.set
                                    // 返回 Map、delete 返回 boolean，两个都会让
                                    // 它当场抛「Unexpected return value」。
                                    ref={node => {
                                        if (node) {
                                            itemRefs.current.set(item.id, node);
                                        } else {
                                            itemRefs.current.delete(item.id);
                                        }
                                    }}
                                >
                                    <Card
                                        className={cn(
                                            'transition-shadow duration-200',
                                            active && 'ring-2 ring-accent'
                                        )}
                                    >
                                        {/* 只有带地点的条目可点——点没有地点的那些，地图无处可去。
                                            用真的 button 而不是给 div 挂 onClick：键盘也要能选。 */}
                                        {placedItem ? (
                                            <button
                                                type="button"
                                                onClick={() => selectFromList(item)}
                                                aria-pressed={active}
                                                className="w-full cursor-pointer rounded-lg p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                            >
                                                {body}
                                            </button>
                                        ) : (
                                            <div className="p-4">{body}</div>
                                        )}
                                    </Card>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
        </div>
    );
}
