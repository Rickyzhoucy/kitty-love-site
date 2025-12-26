"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Heart, MessageCircle, Camera, StickyNote, Star, X } from 'lucide-react';
import styles from './page.module.css';
import Link from 'next/link';
import Countdown from './components/Countdown';

const MENU_ITEMS = [
  { href: '/guestbook', icon: MessageCircle, label: '留言板', color: '#F48FB1' },
  { href: '/memo', icon: StickyNote, label: '备忘录', color: '#4DD0E1' },
  { href: '/gallery', icon: Camera, label: '照片墙', color: '#FFB74D' },
  { href: '/timeline', icon: Star, label: '我们的故事', color: '#BA68C8' },
];

export default function Home() {
  const [showLetter, setShowLetter] = useState(false);

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
      {/* Hello Kitty 3D Model */}
      <div className={styles.modelWrapper}>
        <iframe
          title="hello kitty blush"
          className={styles.sketchfabEmbed}
          frameBorder="0"
          allowFullScreen
          allow="autoplay; fullscreen; xr-spatial-tracking"
          src="https://sketchfab.com/models/f5ffa040dff8471d9031d41f2047017c/embed?autostart=1&ui_hint=0&ui_infos=0&ui_stop=0&ui_inspector=0&ui_watermark_link=0&ui_watermark=0&ui_ar=0&ui_help=0&ui_settings=0&ui_vr=0&ui_fullscreen=0&ui_annotations=0&preload=1&transparent=1"
        />
        {/* Clickable overlay to capture clicks */}
        <div className={styles.clickableOverlay} onClick={handleKittyClick} />
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
        💌 点击 Kitty 查看情书
      </motion.div>

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
                  <h2>致我最爱的人</h2>
                  <Heart fill="#F48FB1" color="#F48FB1" size={20} />
                </div>
              </div>

              <div className={styles.letterContent}>
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
                  ❤️ (你的名字)
                </p>
              </div>

              <div className={styles.letterFooter}>
                <Countdown targetDate="2025-11-30" title="下一个纪念日" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
