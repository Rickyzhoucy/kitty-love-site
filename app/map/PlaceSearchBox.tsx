'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { AMAP_KEY, loadAmap, loadPlugins, type AmapPoi } from './amapLoader';

/**
 * 地点搜索（计划文档 §2.5）。
 *
 * 用 `AMap.AutoComplete` 而不是 `PlaceSearch`：输入提示是边打边给候选，正好
 * 是「我想标个地方」需要的交互；PlaceSearch 更适合「列出这一片所有咖啡馆」。
 *
 * 这是**唯一真正需要安全密钥**的地方——输入提示走的是 Web 服务。底图和打点
 * 都不需要它（见 amapLoader 的说明）。
 */

export interface PickedPlace {
    name: string;
    address: string;
    lng: number;
    lat: number;
}

interface PlaceSearchBoxProps {
    onPick: (place: PickedPlace) => void;
    className?: string;
}

/** 地址字段 SDK 有时给字符串有时给数组，统一成一行字。 */
function flatten(address: AmapPoi['address']): string {
    if (Array.isArray(address)) return address.join('');
    return address ?? '';
}

export default function PlaceSearchBox({ onPick, className }: PlaceSearchBoxProps) {
    const [keyword, setKeyword] = useState('');
    const [tips, setTips] = useState<AmapPoi[]>([]);
    const [open, setOpen] = useState(false);
    const [searching, setSearching] = useState(false);
    const boxRef = useRef<HTMLDivElement | null>(null);
    // 每次请求带一个序号，只认最后一次的结果——打字快时早发的请求可能后回来，
    // 不管的话候选列表会闪回上一个关键词的结果。
    const requestRef = useRef(0);

    useEffect(() => {
        const text = keyword.trim();
        // 关键词空的时候不在这里清 tips——「没输入就没候选」是可以从 keyword
        // 直接推出来的，渲染时算即可（见下面的 shown），不必多存一份状态、
        // 也就不必在 effect 里同步 setState。
        if (!text || !AMAP_KEY) return;
        const ticket = ++requestRef.current;
        // 防抖：输入提示是按次计费的，每敲一个字发一次请求既慢又浪费配额
        const timer = setTimeout(() => {
            setSearching(true);
            void loadAmap()
                .then(async AMap => {
                    await loadPlugins(AMap, ['AMap.AutoComplete']);
                    if (!AMap.AutoComplete || ticket !== requestRef.current) return;
                    new AMap.AutoComplete({ city: '全国' }).search(text, (status, result) => {
                        if (ticket !== requestRef.current) return;
                        setSearching(false);
                        if (status !== 'complete' || typeof result === 'string') {
                            setTips([]);
                            return;
                        }
                        // 没有坐标的候选（纯行政区名）点了也没法定位，直接滤掉
                        setTips((result.tips ?? []).filter(tip => tip.location));
                        setOpen(true);
                    });
                })
                .catch(() => {
                    if (ticket === requestRef.current) {
                        setSearching(false);
                        setTips([]);
                    }
                });
        }, 300);
        return () => clearTimeout(timer);
    }, [keyword]);

    // 点到别处就收起候选
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);

    const choose = (tip: AmapPoi) => {
        if (!tip.location) return;
        onPick({
            name: tip.name ?? '',
            address: `${tip.district ?? ''}${flatten(tip.address)}`,
            lng: tip.location.lng,
            lat: tip.location.lat,
        });
        setKeyword(tip.name ?? '');
        setOpen(false);
    };

    if (!AMAP_KEY) return null;

    // 清空输入框时候选立刻消失，不用等下一次请求回来
    const shown = keyword.trim() ? tips : [];

    return (
        <div ref={boxRef} className={`relative ${className ?? ''}`}>
            <div className="relative">
                <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                />
                <input
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    onFocus={() => shown.length > 0 && setOpen(true)}
                    placeholder="搜个地方…"
                    aria-label="搜索地点"
                    className="w-full rounded-full border border-ink/10 bg-sunken/40 py-2.5 pl-9 pr-9 text-sm text-ink outline-none transition-colors focus:border-accent"
                />
                {keyword && (
                    <button
                        type="button"
                        onClick={() => { setKeyword(''); setOpen(false); }}
                        aria-label="清空搜索"
                        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-ink-muted hover:text-ink"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {open && shown.length > 0 && (
                <ul className="absolute z-20 mt-1.5 max-h-72 w-full list-none overflow-y-auto rounded-lg border border-ink/10 bg-surface p-1 shadow-lift">
                    {shown.map((tip, index) => (
                        <li key={`${tip.id ?? tip.name}-${index}`}>
                            <button
                                type="button"
                                onClick={() => choose(tip)}
                                className="w-full cursor-pointer rounded-md px-3 py-2 text-left transition-colors hover:bg-sunken"
                            >
                                <span className="block truncate text-sm text-ink">{tip.name}</span>
                                <span className="block truncate text-xs text-ink-muted">
                                    {tip.district}{flatten(tip.address)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {searching && shown.length === 0 && (
                <p className="m-0 mt-2 px-1 text-xs text-ink-muted">搜索中…</p>
            )}
        </div>
    );
}
