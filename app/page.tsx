"use client";

import { useState, Suspense, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import confetti from 'canvas-confetti';
import { Heart, MessageCircle, Camera, StickyNote, Star, Sparkles, Calendar, Bell } from 'lucide-react';
import styles from './page.module.css';
import Link from 'next/link';
import KittyStickers from './components/KittyStickers';
import ParticleBackground from './components/ParticleBackground';
import LoveLetter from './components/LoveLetter';

// Dynamic imports
const KittyScene = dynamic(() => import('./components/KittyScene'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingScene}>
      <div className={styles.loadingSpinner}>🎀</div>
      <p>召唤 Kitty 中...</p>
    </div>
  )
});

const HomeTimers = dynamic(() => import('./components/HomeTimers'), { ssr: false });
const RemindersList = dynamic(() => import('./components/RemindersList'), { ssr: false });

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
        if (res.status === 401 && !window.location.pathname.startsWith('/verify')) {
          window.location.href = '/verify?redirect=/';
          return null;
        }
        return res.json();
      })
      .then(data => { if (data) setConfig(data); })
      .catch(e => console.error("Failed to fetch config", e));
  }, []);

  const handleKittyClick = () => {
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { y: 0.6 },
      colors: ['#FFCDD2', '#F48FB1', '#FF69B4', '#FFD700', '#87CEEB']
    });
    setShowLetter(true);
  };

  return (
    <div className={styles.dashboardContainer}>
      <ParticleBackground particleCount={15} />

      {/* Header Bar */}
      <header className={styles.header}>
        <div className={styles.greeting}>
          <h1>
            <Heart size={24} fill="#ff758c" color="#ff758c" className={styles.pulseHeart} />
            我们的秘密小窝
          </h1>
          <p>记录相爱的每一个瞬间，欢迎回家 🏡</p>
        </div>
        
        <div className={styles.headerNav}>
          {MENU_ITEMS.map((item, index) => (
            <Link key={item.href} href={item.href} className={styles.navItem}>
              <div className={styles.navIcon} style={{ background: `linear-gradient(135deg, ${item.color}80, ${item.color})` }}>
                <item.icon size={20} color="white" />
              </div>
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          ))}
        </div>
      </header>

      {/* Bento Box Main Grid */}
      <main className={styles.bentoGrid}>
        
        {/* 3D Hero Card (Takes up major space) */}
        <div className={`${styles.bentoCard} ${styles.heroCard}`}>
          <div className={styles.modelWrapper}>
            <Suspense fallback={<div className={styles.loadingScene}>加载中...</div>}>
              <KittyScene onKittyClick={handleKittyClick} modelUrl={config.home_model_url} />
            </Suspense>
          </div>
          <div className={styles.heroOverlay}>
            <button onClick={handleKittyClick} className={styles.interactionBtn}>
              <Sparkles size={18} /> 点击 Kitty 有惊喜
            </button>
          </div>
        </div>

        {/* Timers Card */}
        <div className={`${styles.bentoCard} ${styles.timersCard}`}>
          <h3 className={styles.cardHeader}>
            <Calendar size={18} color="#FF69B4" /> 专属纪念日
          </h3>
          <div className={styles.scrollArea}>
             <HomeTimers />
          </div>
        </div>

        {/* Reminders Card */}
        <div className={`${styles.bentoCard} ${styles.remindersCard}`}>
          <h3 className={styles.cardHeader}>
            <Bell size={18} color="#4DD0E1" /> 备忘与提醒
          </h3>
          <div className={styles.scrollArea}>
            <RemindersList />
          </div>
        </div>

      </main>

      <LoveLetter
        isOpen={showLetter}
        onClose={() => setShowLetter(false)}
        config={config}
      />
    </div>
  );
}
