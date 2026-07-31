'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 首页那块「我们四个」。
 *
 * ## 为什么是视频而不是骨骼动画
 *
 * 本来打算把四个人切成部件、绑骨骼、用 Rive 播。做到一半换成了视频，理由是
 * 呼吸的起伏、眨眼、头发和衣角的飘动、狗毛的抖动——这些微动作是逐帧手调
 * 调不出来的，而首页这块**不需要交互**，它只是给人看的。（全站跟随的那只
 * 宠物仍然是 Rive，因为它要跟着状态走、睡、思考，那才需要状态机。）
 *
 * ## 循环是怎么接上的
 *
 * 视频模型默认不循环，最后一帧接不回第一帧，`loop` 播放每几秒会「跳」一下。
 * 生成时把**同一张图既当首帧又当尾帧**，模型被约束成从这张画出发再回到这张
 * 画。实测首尾帧平均差 1.50/255，只有 1.24% 的像素差超过 12——接缝看不出来。
 * 见 `scripts/generate-hero-video.py`。
 *
 * ## 静态模式是真的静态
 *
 * 关掉动效时**不渲染 `<video>`**，而不是渲染出来再暂停。差别在于前者根本不去
 * 下载那 196KB；`prefers-reduced-motion` 的人和明确点了「静一静」的人，都不该
 * 为一个他们不会看的动画付流量。海报图 `us.webp` 本来就是同一张画的静帧，
 * 两种模式之间切换看起来是连续的。
 */

const STORAGE_KEY = 'hero-motion';

/**
 * 动效开关的状态源。
 *
 * 用 `useSyncExternalStore` 而不是「useState + useEffect 里读 localStorage」：
 * 后者在服务端渲染时拿不到值，首屏会先渲染默认值再跳一下（hydration 不一致），
 * 而且 React 19 会拦「在 effect 里 setState」。这个 hook 就是为这种「组件外部
 * 的可变数据源」设计的，服务端快照单独给。
 */
function subscribe(onChange: () => void) {
    window.addEventListener('storage', onChange);
    window.addEventListener('hero-motion-change', onChange);
    return () => {
        window.removeEventListener('storage', onChange);
        window.removeEventListener('hero-motion-change', onChange);
    };
}

function readMotion(): boolean {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'on';
    // 没存过就跟随系统设置：调了「减弱动态效果」的人，默认就该是静的。
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 服务端没有 localStorage，也没有系统偏好。先按静态渲染——先静后动不刺眼，
 *  反过来（先动起来再被关掉）会闪。 */
function serverMotion(): boolean {
    return false;
}

export default function HomeStage({ onOpenLetter }: { onOpenLetter: () => void }) {
    const motion = useSyncExternalStore(subscribe, readMotion, serverMotion);

    const toggle = useCallback(() => {
        window.localStorage.setItem(STORAGE_KEY, motion ? 'off' : 'on');
        window.dispatchEvent(new Event('hero-motion-change'));
    }, [motion]);

    return (
        <div>
            <button
                type="button"
                onClick={onOpenLetter}
                aria-label="点开今天的信"
                className={cn(
                    'group relative block aspect-square w-full overflow-hidden rounded-[28px]',
                    'border border-ink/5 bg-[#fdf3d4] shadow-lift transition-shadow duration-500 hover:shadow-modal',
                    'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'
                )}
            >
                {motion ? (
                    <video
                        // 每次开关都重新挂载，避免复用上一次的播放位置。
                        key="stage-video"
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-700 ease-spring group-hover:scale-[1.03]"
                        // 三个属性缺一不可：移动端只有同时 muted + playsInline
                        // 才允许自动播放，否则 iOS 会把它顶成全屏播放器。
                        autoPlay
                        muted
                        loop
                        playsInline
                        poster="/hero/us.webp"
                    >
                        <source src="/hero/us-idle.webm" type="video/webm" />
                        <source src="/hero/us-idle.mp4" type="video/mp4" />
                    </video>
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src="/hero/us.webp"
                        alt="我们两个各抱着一只狗的插画"
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-700 ease-spring group-hover:scale-[1.03]"
                    />
                )}
            </button>

            <p className="mt-4 mb-0 flex items-center justify-center gap-3 text-sm text-ink-muted">
                <span className="pointer-events-none">💌 点一下，有一封信</span>
                <button
                    type="button"
                    onClick={toggle}
                    // 说的是「点下去会发生什么」，不是「现在是什么状态」——
                    // 按钮的名字应该是它的动作。
                    aria-label={motion ? '让画面静下来' : '让画面动起来'}
                    title={motion ? '让画面静下来' : '让画面动起来'}
                    className="rounded-full p-1.5 text-ink-muted/70 transition-colors hover:bg-sunken/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    {motion ? <Pause size={14} /> : <Play size={14} />}
                </button>
            </p>
        </div>
    );
}
