"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import Link from 'next/link';
import { ArrowUpRight, BookHeart, StickyNote, Image as ImageIcon, Sparkles, type LucideIcon } from 'lucide-react';
import LoveLetter from './components/LoveLetter';
import HomeTimers from './components/HomeTimers';
import RemindersList from './components/RemindersList';
import { configApi, photosApi } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';

/**
 * 首页那张画的纸色。
 *
 * 这里曾经是一只 3D Hello Kitty（three.js + 6.8MB 贴图 + 1.4MB HDR），
 * 它有三个问题：开着 autoRotate，所以大半时间给访客看后脑勺；塑料手办的
 * 材质和站里的奶油+玫瑰插画完全是两个世界；而且它跟全站跟随的那只宠物
 * 抢角色——首页正中间该站的是**他们两个**，宠物有自己的岗位。
 *
 * 换成一张画之后，这个色是画自身的纸底。图幅不是严格 1:1 时，contain 补出来
 * 的边靠它填平。**换画就改这一个值**（取新画四角的颜色）。
 */
const PRINT_PAPER = '#f9f3e4';

const QUICK_LINKS = [
  { href: '/guestbook', num: '01', label: '留言板', en: 'Guestbook', icon: BookHeart },
  { href: '/plan', num: '02', label: '计划', en: 'Plans', icon: StickyNote },
  { href: '/gallery', num: '03', label: '照片墙', en: 'Gallery', icon: ImageIcon },
  { href: '/timeline', num: '04', label: '我们的故事', en: 'Our Story', icon: Sparkles },
];

const MARQUEE_ITEMS = ['我们的小世界', 'Our Little World', '柴米油盐', 'Every Little Thing', '来日方长', 'Forever & Always'];

/** 缩略图聚合簇：三张层叠小卡，hover 扇形展开 */
function ThumbCluster({ icon: Icon, photos }: { icon: LucideIcon; photos?: string[] }) {
  const tileMotion = [
    'z-0 -rotate-6 group-hover:-translate-x-[150%] group-hover:-rotate-12',
    'z-10 group-hover:scale-110',
    'z-0 rotate-6 group-hover:translate-x-[50%] group-hover:rotate-12',
  ];
  return (
    <span className="relative block h-16 w-20" aria-hidden>
      {tileMotion.map((motionCls, i) => {
        const url = photos?.[i];
        return (
          <span
            key={i}
            className={cn(
              'absolute inset-y-0 left-1/2 w-14 -translate-x-1/2 overflow-hidden rounded-lg border-2 border-surface bg-accent-soft shadow-soft',
              'transition-all duration-300 ease-spring',
              motionCls
            )}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Icon size={18} className="text-accent" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export default function Home() {
  const reduceMotion = useReducedMotion();
  const [showLetter, setShowLetter] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [daysTogether, setDaysTogether] = useState<number | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  useEffect(() => {
    configApi.get()
      .then(data => {
        if (!data) return;
        setConfig(data);
        // 在一起天数：与情书弹窗同一数据源。**不在这里兜默认值**——
        // 默认值是服务端给的（backend/app/site_config.py），前端再兜一个
        // 就成了两份真相，而宠物读的是服务端那份，说出来的天数会和这里对不上。
        const diff = Date.now() - new Date(data.main_timer_date).getTime();
        if (diff > 0) setDaysTogether(Math.floor(diff / 86400000));
      })
      .catch(e => console.error('Failed to fetch config', e));
  }, []);

  // 照片墙入口的缩略图：取最新 3 张真实照片
  const loadPhotoUrls = useCallback(async () => {
    try {
      const photos = await photosApi.list();
      setPhotoUrls(photos.map(photo => photo.url).filter(Boolean).slice(0, 3));
    } catch (error) {
      console.error('Failed to fetch photos', error);
    }
  }, []);

  useEffect(() => {
    photosApi.list()
      .then(photos => setPhotoUrls(photos.map(photo => photo.url).filter(Boolean).slice(0, 3)))
      .catch(error => console.error('Failed to fetch photos', error));
  }, []);
  useResourceEvents(['photos'], () => void loadPhotoUrls());

  const handleOpenLetter = () => {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#c06a5e', '#d99a2b', '#e8b4a6', '#f2d8a7', '#fffdf9'],
    });
    setShowLetter(true);
  };

  return (
    <div className="w-full overflow-x-clip">
      {/* ═══ Hero：左标题 + 右 Kitty 舞台，零留白 ═══ */}
      <section className="relative overflow-hidden">
        {/* 漂移极光（装饰层） */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-drift absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-accent/15 blur-3xl" />
          <div className="animate-drift absolute top-1/3 -right-32 h-[380px] w-[380px] rounded-full bg-secondary/20 blur-3xl [animation-delay:-8s]" />
        </div>

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-5 py-10 md:py-14 md:grid-cols-2 md:px-8">
          {/* 左：标题组 */}
          <div>
            <motion.p
              className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.45em] text-accent m-0"
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              Welcome To Our Little World
            </motion.p>
            <h1 className="mt-4 m-0 font-display font-semibold leading-[0.95] tracking-wide">
              <motion.span
                className="block text-[16vw] md:text-[6.5rem] text-ink"
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                我们的
              </motion.span>
              <motion.span
                className="block text-[16vw] md:text-[6.5rem] text-stroke-accent"
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                小世界
              </motion.span>
            </h1>
            {daysTogether !== null && (
              <motion.p
                className="mt-5 font-display text-lg md:text-2xl text-ink-muted mb-0"
                initial={false}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 0.6 }}
              >
                — 在一起的第 <span className="text-accent font-semibold tabular-nums">{daysTogether}</span> 天 —
              </motion.p>
            )}
          </div>

          {/* 右：我们四个的合照 */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.button
              type="button"
              onClick={handleOpenLetter}
              aria-label="点开今天的信"
              className={cn(
                'group relative block aspect-square w-full overflow-hidden rounded-[28px]',
                'border border-ink/5 shadow-lift transition-shadow duration-500 hover:shadow-modal',
                'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'
              )}
              // 底色跟画本身的奶油纸色对齐，图不是正方形时补出来的边看不见。
              // 换画就调这一个值（取画四角的颜色）。
              style={{ backgroundColor: PRINT_PAPER }}
              // 极缓慢的上下浮动，代替原来 3D 那圈自转。幅度只有 6px——
              // 让它有呼吸，而不是让它表演。
              animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            >
              {/* **这里不能用 next/image。**
                  `proxy.ts` 那道鉴权门会把没带 Cookie 的请求 307 到 /verify，而
                  Next 的图片优化器是**服务端自己去 fetch 这个 URL** 的，它不带
                  浏览器的 Cookie——拿回来的是登录页的 HTML，于是报
                  「The requested resource isn't a valid image」，首页一个大裂图。
                  （门里放行了 /_next、/pet-content、/uploads，唯独没有静态图片。）

                  用普通 <img> 就是浏览器自己带着 Cookie 去取，门还拦得住，也不
                  经过优化器。代价是没有自动压缩，所以这张图**入库前先转成合适
                  尺寸的 WebP**，别直接丢一张 4K PNG 进来。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero/us.webp"
                alt="我们两个各抱着一只狗的插画"
                // contain 而不是 cover：画幅万一不是严格 1:1，宁可两边留白，
                // 也不能把谁的脚或头裁掉。
                className="absolute inset-0 h-full w-full object-contain transition-transform duration-700 ease-spring group-hover:scale-[1.03]"
              />

              {/* 原来这条提示是 1.6 秒后淡入的——那是在等 3D 模型加载完。
                  现在图是秒出的，延迟淡入只会让「能点」这件事晚一步被看见，
                  而且页面上其余元素一律 `initial={false}` 不做入场。所以就是
                  一个普通 span。 */}
              <span className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-ink/5 bg-surface/80 px-5 py-2 text-sm text-accent shadow-soft backdrop-blur-md">
                💌 点一下，有一封信
              </span>
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* ═══ Marquee 横幅：倾斜 accent 色带无限滚动 ═══ */}
      <section aria-hidden className="relative z-20 -my-3 -rotate-2 select-none">
        <div className="w-[110vw] -ml-[5vw] overflow-hidden bg-accent py-3 shadow-lift">
          <div className="animate-marquee flex w-max items-center gap-8 pr-8">
            {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
              <span key={i} className="flex items-center gap-8 whitespace-nowrap font-display text-lg tracking-widest text-on-accent">
                {item}
                <span className="text-sm opacity-70">✦</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 01 纪念日：全宽横向卡带（破容器出血） ═══ */}
      <motion.section
        className="mt-16 md:mt-24"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mx-auto max-w-5xl px-4">
          <HomeTimers />
        </div>
      </motion.section>

      {/* ═══ 02 提醒：右偏移窄栏（不对称） ═══ */}
      <motion.section
        className="mx-auto mt-16 md:mt-24 max-w-5xl px-4 md:flex md:justify-end"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="md:w-2/3 lg:w-1/2">
          <RemindersList />
        </div>
      </motion.section>

      {/* ═══ 03 去哪儿：编辑式破网格卡片 ═══ */}
      <motion.section
        aria-label="快速入口"
        className="mx-auto mt-16 md:mt-24 max-w-6xl px-4 pb-16"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="flex items-baseline gap-3 mb-8 px-1 m-0">
          <span aria-hidden className="font-display text-5xl font-semibold leading-none text-stroke-accent select-none">03</span>
          <span className="font-display text-2xl font-semibold tracking-wide text-ink">去哪儿</span>
        </h2>
        <div className="flex flex-col gap-6 md:gap-0">
          {QUICK_LINKS.map((item, index) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group relative flex items-center gap-5 overflow-hidden rounded-lg border border-ink/5 bg-surface p-5 shadow-soft md:p-7',
                  'transition-all duration-300 ease-spring hover:shadow-lift hover:-translate-y-1',
                  // 桌面破网格：奇偶行宽度/旋转/缩进交错
                  index % 2 === 0
                    ? 'md:w-[86%] md:self-start md:-rotate-[0.5deg]'
                    : 'md:w-[86%] md:self-end md:rotate-[0.5deg] md:-mt-5'
                )}
              >
                <span
                  aria-hidden
                  className="font-display text-5xl md:text-7xl font-semibold leading-none text-stroke-accent select-none shrink-0"
                >
                  {item.num}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-display text-2xl md:text-4xl font-semibold tracking-wide text-ink transition-colors duration-300 group-hover:text-accent">
                      {item.label}
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">
                      {item.en}
                    </span>
                  </span>
                </span>
                <span className="hidden sm:block shrink-0">
                  <ThumbCluster icon={Icon} photos={item.href === '/gallery' ? photoUrls : undefined} />
                </span>
                <ArrowUpRight
                  size={26}
                  className="shrink-0 text-ink-muted/40 transition-all duration-300 group-hover:text-accent group-hover:rotate-45"
                />
              </Link>
            );
          })}
        </div>
      </motion.section>

      <LoveLetter isOpen={showLetter} onClose={() => setShowLetter(false)} config={config} />
    </div>
  );
}
