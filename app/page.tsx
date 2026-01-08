"use client";

import { useState, Suspense, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import confetti from 'canvas-confetti';
import { Heart, MessageCircle, Camera, StickyNote, Star } from 'lucide-react';
import styles from './page.module.css';
import Link from 'next/link';
import KittyStickers from './components/KittyStickers';
import ParticleBackground from './components/ParticleBackground';
import LoveLetter from './components/LoveLetter';

// Dynamic imports with SSR disabled to prevent hydration mismatch
const KittyScene = dynamic(() => import('./components/KittyScene'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingScene}>
      <div className={styles.loadingSpinner}>🎀</div>
      <p>正在召唤 Hello Kitty...</p>
    </div>
  )
});

const HomeTimers = dynamic(() => import('./components/HomeTimers'), {
  ssr: false
});

const RemindersList = dynamic(() => import('./components/RemindersList'), {
  ssr: false
});

const MENU_ITEMS = [
  { href: '/guestbook', icon: MessageCircle, label: '留言板', color: '#F48FB1' },
  { href: '/memo', icon: StickyNote, label: '备忘录', color: '#4DD0E1' },
  { href: '/gallery', icon: Camera, label: '照片墙', color: '#FFB74D' },
  { href: '/timeline', icon: Star, label: '我们的故事', color: '#BA68C8' },
];

export default function Home() {
  const [showLetter, setShowLetter] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/admin/config')
      .then(res => {
        if (res.status === 401) {
          // Don't redirect if already on verify page
          if (!window.location.pathname.startsWith('/verify')) {
            window.location.href = '/verify?redirect=/';
          }
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data) setConfig(data);
      })
      .catch(e => console.error("Failed to fetch config", e));
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

      {/* Custom Timers List (Refactored) */}
      <HomeTimers />

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

      {/* Love Letter Modal (Refactored) */}
      <LoveLetter
        isOpen={showLetter}
        onClose={() => setShowLetter(false)}
        config={config}
      />

      {/* Reminders List - Bottom Left */}
      <div style={{ position: 'fixed', bottom: '100px', left: '20px', zIndex: 10 }}>
        <RemindersList />
      </div>

    </div>
  );
}
