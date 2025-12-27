"use client";

import { useState, Suspense, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import confetti from 'canvas-confetti';
import { Heart, MessageCircle, Camera, StickyNote, Star, X } from 'lucide-react';
import styles from './page.module.css';
import Link from 'next/link';
import Countdown from './components/Countdown';
import KittyStickers from './components/KittyStickers';
import ParticleBackground from './components/ParticleBackground';

// Dynamic import for 3D scene (client-side only)
const KittyScene = dynamic(() => import('./components/KittyScene'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingScene}>
      <div className={styles.loadingSpinner}>🎀</div>
      <p>正在召唤 Hello Kitty...</p>
    </div>
  )
});

const MENU_ITEMS = [
  { href: '/guestbook', icon: MessageCircle, label: '留言板', color: '#F48FB1' },
  { href: '/memo', icon: StickyNote, label: '备忘录', color: '#4DD0E1' },
  { href: '/gallery', icon: Camera, label: '照片墙', color: '#FFB74D' },
  { href: '/timeline', icon: Star, label: '我们的故事', color: '#BA68C8' },
];

interface EventTimer {
  id: string;
  title: string;
  date: string;
  type: 'countup' | 'countdown';
}

export default function Home() {
  const [showLetter, setShowLetter] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [timers, setTimers] = useState<EventTimer[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [configRes, timersRes] = await Promise.all([
          fetch('/api/admin/config'),
          fetch('/api/timers')
        ]);

        if (configRes.ok) setConfig(await configRes.json());
        if (timersRes.ok) setTimers(await timersRes.json());
      } catch (e) {
        console.error("Failed to fetch data", e);
      }
    };
    fetchData();
  }, []);

  const handleKittyClick = () => {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#FFCDD2', '#F48FB1', '#FF69B4', '#FFD700', '#87CEEB']
    });
    setShowLetter(true);
  };

  return (
    <div className={styles.container}>
      {/* 动态贴纸和粒子效果 */}
      <KittyStickers count={8} />
      <ParticleBackground particleCount={12} />

      {/* 3D Model Scene */}
      <div className={styles.modelWrapper}>
        <Suspense fallback={<div className={styles.loadingScene}>加载中...</div>}>
          <KittyScene onKittyClick={handleKittyClick} modelUrl={config.home_model_url} />
        </Suspense>
      </div>

      {/* Welcome Title */}
      <motion.div
        className={styles.titleOverlay}
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h1>
          <Heart fill="#F48FB1" color="#F48FB1" size={20} />
          欢迎来到我们的小世界
          <Heart fill="#F48FB1" color="#F48FB1" size={20} />
        </h1>
      </motion.div>

      {/* Click Hint */}
      <motion.div
        className={styles.clickHint}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        💌 点击 Kitty 有惊喜
      </motion.div>

      {/* Custom Timers List - Left Top */}
      <div className={styles.timersList} style={{ position: 'fixed', top: '20px', left: '20px', zIndex: 10 }}>
        <AnimatePresence>
          {timers.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1 + idx * 0.2 }}
              style={{ marginBottom: '10px' }}
            >
              <Countdown startDate={t.date} title={t.title} type={t.type} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Floating Bubble Menu - Right Side */}
      <div className={styles.bubbleMenu}>
        {MENU_ITEMS.map((item, index) => (
          <motion.div
            key={item.href}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8 + index * 0.15 }}
          >
            <Link href={item.href} className={styles.bubbleItem}>
              <div className={styles.bubbleIcon} style={{ backgroundColor: item.color }}>
                <item.icon size={22} color="white" />
              </div>
              <span className={styles.bubbleLabel}>{item.label}</span>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Floating Decorations */}
      <div className={styles.decorations}>
        <motion.span
          className={styles.floatItem1}
          animate={{ y: [-10, 10, -10] }}
          transition={{ duration: 4, repeat: Infinity }}
        >💖</motion.span>
        <motion.span
          className={styles.floatItem2}
          animate={{ y: [10, -10, 10] }}
          transition={{ duration: 5, repeat: Infinity }}
        >🎀</motion.span>
        <motion.span
          className={styles.floatItem3}
          animate={{ y: [-5, 15, -5] }}
          transition={{ duration: 3.5, repeat: Infinity }}
        >⭐</motion.span>
      </div>

      {/* Love Letter Modal */}
      <AnimatePresence>
        {showLetter && (
          <motion.div
            className={styles.letterOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLetter(false)}
          >
            <motion.div
              className={styles.letterCard}
              initial={{ scale: 0.5, y: 100, rotateX: 30 }}
              animate={{ scale: 1, y: 0, rotateX: 0 }}
              exit={{ scale: 0.5, y: 100 }}
              transition={{ type: "spring", damping: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className={styles.closeBtn} onClick={() => setShowLetter(false)}>
                <X size={22} />
              </button>

              <div className={styles.letterHeader}>
                <img
                  src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                  alt="Hello Kitty"
                  className={styles.kittyImg}
                />
                <div className={styles.letterTitle}>
                  <Heart fill="#F48FB1" color="#F48FB1" size={20} />
                  <h2>{config.letter_title || '致我最爱的人'}</h2>
                  <Heart fill="#F48FB1" color="#F48FB1" size={20} />
                </div>
              </div>

              <div className={styles.letterContent}>
                {config.letter_content ? (
                  <div dangerouslySetInnerHTML={{ __html: config.letter_content }} />
                ) : (
                  <>
                    <p>亲爱的，</p>
                    <p>
                      自从你走进我的生活，一切都变得更加明亮和美好。
                      这个小小的网页是专门为你准备的——一个保存我们回忆、发送小纸条，
                      并提醒我有多么爱你的地方。
                    </p>
                    <p>
                      如果你是 Hello Kitty，那我就是永远守护你的 Daniel。
                      你是我的星辰，也是我的闪光。
                      希望你会喜欢这个小惊喜！
                    </p>
                    <p className={styles.closing}>
                      永远爱你的，<br />
                      ❤️ 爱你的老公！
                    </p>
                  </>
                )}
              </div>

              <div className={styles.letterFooter}>
                <Countdown
                  startDate={config.main_timer_date || "2025-11-30"}
                  title="我们在一起已经"
                  type="countup"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
