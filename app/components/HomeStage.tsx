'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

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
 * ## 房间是模型自己长出来的
 *
 * 背景不是我拼进去的。之前试过三轮文生图去做「一间屋子」，全废——模型总是
 * 用另一套绘画语言回答（扁平矢量的红沙发、摄影式的散景），跟这四位的柔和
 * 厚涂对不上。**图生视频没有这个问题**：它是在延续输入图，背景自然就是同一
 * 种笔触。所以这一版是把四位的立绘当 `reference_image` 丢进去，让 H3 自己
 * 长出窗、阳光、纱帘、木地板、地毯和绿植。
 *
 * ## 循环：先试过捆死动作，那是错的
 *
 * 第一版为了无缝循环，把同一张图同时当首帧和尾帧，并在提示词里写死「不走动、
 * 不转身、不换姿势」。接缝确实极好（首尾差 1.24%），但代价是**除了呼吸什么
 * 都不发生**——为一个技术指标牺牲了观感。
 *
 * 现在反过来：动作放开，循环交给转码。取尾部 2.4 秒淡入叠回开头，8 秒素材
 * 变成 5.6 秒的循环。实测把接缝从 8.90% 压到 4.61%，而且是柔和过渡而不是硬
 * 跳。淡化时长不是越长越好（0.7s→5.31%、1.2s→7.71%、1.8s→6.36%、2.4s→4.61%），
 * 换素材要重新扫一遍。生成和转码见 `scripts/generate-hero-video.py`。
 *
 * ## 素材可以在后台换掉
 *
 * 默认用的是镜像里自带的 `public/hero/*`。后台传过新的之后，`/site/hero` 会
 * 返回一个接口地址，这里优先用它——**换首页那张图不再需要重新部署**。
 *
 * ## 静态模式是真的静态
 *
 * 关掉动效时**不渲染 `<video>`**，而不是渲染出来再暂停。差别在于前者根本不去
 * 下载那 581KB；`prefers-reduced-motion` 的人和明确点了暂停的人，都不该为一个
 * 他们不会看的动画付流量。海报图 `us.webp` 就是这段视频的第 0 帧，所以两种
 * 模式看到的是同一个房间，切换看起来是连续的。
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

/** 镜像里自带的那份。后台没传过素材时用它。 */
const BUILTIN = { video: '/hero/us-idle.mp4', poster: '/hero/us.webp' };

export default function HomeStage({ onOpenLetter }: { onOpenLetter: () => void }) {
    const motion = useSyncExternalStore(subscribe, readMotion, serverMotion);
    const [sources, setSources] = useState(BUILTIN);

    useEffect(() => {
        let cancelled = false;
        api.get<{ video: string | null; poster: string | null }>('/site/hero')
            .then(custom => {
                if (cancelled) return;
                setSources({
                    video: custom.video ?? BUILTIN.video,
                    poster: custom.poster ?? BUILTIN.poster,
                });
            })
            // 拿不到就用自带的。首页不该因为一个装饰性接口挂了而开天窗。
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

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
                    // 底色取自视频四角的平均色（木地板的暖棕）。素材是 1:1、
                    // 容器也是 1:1，正常不会露出来；它兜的是视频加载前那一瞬、
                    // 以及将来换成非正方形素材时 contain 补出来的边。
                    'border border-ink/5 bg-[#b18962] shadow-lift transition-shadow duration-500 hover:shadow-modal',
                    'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'
                )}
            >
                {motion ? (
                    <video
                        // 每次开关都重新挂载，避免复用上一次的播放位置。
                        key={sources.video}
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-700 ease-spring group-hover:scale-[1.03]"
                        // 三个属性缺一不可：移动端只有同时 muted + playsInline
                        // 才允许自动播放，否则 iOS 会把它顶成全屏播放器。
                        autoPlay
                        muted
                        loop
                        playsInline
                        poster={sources.poster}
                    >
                        {/* 只给 mp4。同一段片子 VP9 编出来 795KB、x264 只要
                            581KB——这种柔和的厚涂插画没什么高频细节，VP9 占不到
                            便宜。H.264 全平台都认，少一个源也少一处会出错的地方。 */}
                        <source src={sources.video} type="video/mp4" />
                    </video>
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={sources.poster}
                        alt="我们两个和两只狗在洒满阳光的客厅里"
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
