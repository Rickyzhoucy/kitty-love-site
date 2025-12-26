"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Heart, MessageCircle, Camera, StickyNote, Star, Sparkles, Menu, X } from 'lucide-react';
import styles from './page.module.css';
import Link from 'next/link';

const QUICK_LINKS = [
  { href: '/guestbook', icon: MessageCircle, label: '留言板', color: '#F48FB1' },
  { href: '/memo', icon: StickyNote, label: '备忘录', color: '#4DD0E1' },
  { href: '/gallery', icon: Camera, label: '照片墙', color: '#FFB74D' },
  { href: '/timeline', icon: Star, label: '我们的故事', color: '#BA68C8' },
];

export default function Home() {
  const [showMessage, setShowMessage] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleKittyClick = () => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.5 },
      colors: ['#FFCDD2', '#F48FB1', '#FF69B4', '#FFD700', '#87CEEB']
    });
    setShowMessage(true);
    setTimeout(() => setShowMessage(false), 3000);
  };

  return (
    <div className={styles.container}>
      {/* Hello Kitty 3D Model - Sketchfab Embed (hello kitty blush) */}
      <div className={styles.modelWrapper} onClick={handleKittyClick}>
        <iframe
          title="hello kitty blush"
          className={styles.sketchfabEmbed}
          frameBorder="0"
          allowFullScreen
          allow="autoplay; fullscreen; xr-spatial-tracking"
          src="https://sketchfab.com/models/f5ffa040dff8471d9031d41f2047017c/embed?autostart=1&ui_hint=0&ui_infos=0&ui_stop=0&ui_inspector=0&ui_watermark_link=0&ui_watermark=0&ui_ar=0&ui_help=0&ui_settings=0&ui_vr=0&ui_fullscreen=0&ui_annotations=0&preload=1&transparent=1"
        />
      </div>

      {/* Welcome Title */}
      <motion.div
        className={styles.titleOverlay}
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h1>
          <Heart fill="#F48FB1" color="#F48FB1" size={22} />
          欢迎来到我们的小世界
          <Heart fill="#F48FB1" color="#F48FB1" size={22} />
        </h1>
      </motion.div>

      {/* Click Hint */}
      <motion.div
        className={styles.clickHint}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        <Sparkles size={14} /> 点击 Kitty 获得惊喜
      </motion.div>

      {/* Speech Bubble */}
      <AnimatePresence>
        {showMessage && (
          <motion.div
            className={styles.speechBubble}
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
          >
            <span className={styles.bubbleEmoji}>💕</span>
            <p>欢迎你呀～ 点击右下角菜单探索更多！</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Menu Button */}
      <motion.button
        className={styles.floatingMenuBtn}
        onClick={() => setMenuOpen(!menuOpen)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        {menuOpen ? <X size={24} /> : <Menu size={24} />}
      </motion.button>

      {/* Floating Menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className={styles.floatingMenu}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
          >
            {QUICK_LINKS.map((link, index) => (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Link href={link.href} className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                  <div className={styles.menuIcon} style={{ backgroundColor: link.color }}>
                    <link.icon size={20} color="white" />
                  </div>
                  <span>{link.label}</span>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Decorations */}
      <div className={styles.decorations}>
        <motion.span
          className={styles.floatItem1}
          animate={{ y: [-10, 10, -10], rotate: [0, 10, 0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity }}
        >💖</motion.span>
        <motion.span
          className={styles.floatItem2}
          animate={{ y: [10, -10, 10], rotate: [0, -10, 0, 10, 0] }}
          transition={{ duration: 5, repeat: Infinity }}
        >🎀</motion.span>
        <motion.span
          className={styles.floatItem3}
          animate={{ y: [-5, 15, -5] }}
          transition={{ duration: 3.5, repeat: Infinity }}
        >⭐</motion.span>
      </div>
    </div>
  );
}
