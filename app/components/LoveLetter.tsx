"use client";

import { Heart } from 'lucide-react';
import Countdown from './Countdown';
import Modal from './ui/Modal';

interface LoveLetterProps {
    isOpen: boolean;
    onClose: () => void;
    config: Record<string, string>;
}

function legacyHtmlToText(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .trim();
}

export default function LoveLetter({ isOpen, onClose, config }: LoveLetterProps) {
    const letterTitle = config.letter_title || '致我最爱的人';

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()} title={letterTitle} hideTitle>
            {/* 信件头：心形环绕衬线标题 */}
            <div className="mb-5 flex items-center justify-center gap-2.5 flex-wrap">
                <Heart size={16} className="text-accent" fill="currentColor" />
                <h2 className="font-display text-xl md:text-2xl font-semibold tracking-wide text-accent m-0">
                    {letterTitle}
                </h2>
                <Heart size={16} className="text-accent" fill="currentColor" />
            </div>

            <div className="text-ink leading-loose text-sm md:text-base">
                {config.letter_content ? (
                    <p className="m-0 whitespace-pre-wrap">
                        {legacyHtmlToText(config.letter_content)}
                    </p>
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
                        <p className="italic text-accent font-display">
                            永远爱你的，<br />
                            ❤️ 爱你的老公！
                        </p>
                    </>
                )}
            </div>

            <div className="mt-5 pt-5 border-t border-sunken flex justify-center">
                <Countdown
                    startDate={config.main_timer_date || '2025-11-30'}
                    title="我们在一起已经"
                    type="countup"
                />
            </div>
        </Modal>
    );
}
