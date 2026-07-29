"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import Link from 'next/link';
import { ArrowUpRight, BookHeart, StickyNote, Image as ImageIcon, Sparkles, type LucideIcon } from 'lucide-react';
import LoveLetter from './components/LoveLetter';
import HomeTimers from './components/HomeTimers';
import RemindersList from './components/RemindersList';
import { configApi, photosApi } from '@/lib/api/resources';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';

// 3D Hello Kitty 体积较大（three.js），客户端按需加载
const KittyScene = dynamic(() => import('./components/KittyScene'), { ssr: false });

const QUICK_LINKS = [
  { href: '/guestbook', num: '01', label: '留言板', en: 'Guestbook', icon: BookHeart },
  { href: '/memo', num: '02', label: '备忘录', en: 'Memos', icon: StickyNote },
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
  const [showLetter, setShowLetter] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [daysTogether, setDaysTogether] = useState<number | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  useEffect(() => {
    configApi.get()
      .then(data => {
        if (!data) return;
        setConfig(data);
        // 在一起天数：与情书弹窗同一数据源
        const diff = Date.now() - new Date(data.main_timer_date || '2025-11-30').getTime();
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

  const handleKittyClick = () => {
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

          {/* 右：Kitty 方形舞台 */}
          <motion.div
            aria-label="宠物 Kitty"
            className="relative aspect-square w-full overflow-hidden rounded-lg border border-ink/5 bg-surface shadow-lift"
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* 舞台极光 */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="animate-drift absolute -top-20 left-1/4 h-[300px] w-[300px] rounded-full bg-accent/15 blur-3xl" />
              <div className="animate-drift absolute -bottom-24 right-1/5 h-[280px] w-[280px] rounded-full bg-secondary/20 blur-3xl [animation-delay:-6s]" />
            </div>

            <div className="absolute inset-0 cursor-pointer">
              <KittyScene onKittyClick={handleKittyClick} modelUrl={config.home_model_url || undefined} />
            </div>

            {/* 舞台角标 */}
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-ink/5 bg-surface/75 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-accent shadow-soft backdrop-blur-md">
              小管家 Kitty
            </div>

            {/* 舞台内提示 */}
            <motion.div
              className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-ink/5 bg-surface/75 px-5 py-2 text-sm text-accent shadow-soft backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6 }}
            >
              💌 点击 Kitty 有惊喜
            </motion.div>
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
