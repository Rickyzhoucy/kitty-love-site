"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { Heart, X } from 'lucide-react';
import Countdown from './Countdown';
import styles from '../page.module.css'; // We'll try to reuse page modules or copy necessary styles

interface LoveLetterProps {
    isOpen: boolean;
    onClose: () => void;
    config: Record<string, string>;
}

export default function LoveLetter({ isOpen, onClose, config }: LoveLetterProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className={styles.letterOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.8)', zIndex: 2000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <motion.div
                        className={styles.letterCard}
                        initial={{ scale: 0.5, y: 100, rotateX: 30 }}
                        animate={{ scale: 1, y: 0, rotateX: 0 }}
                        exit={{ scale: 0.5, y: 100 }}
                        transition={{ type: "spring", damping: 20 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button className={styles.closeBtn} onClick={onClose}>
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
    );
}
