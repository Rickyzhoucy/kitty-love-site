"use client";

import { Heart } from 'lucide-react';
import Countdown from './Countdown';
import Modal from './ui/Modal';

interface LoveLetterProps {
    isOpen: boolean;
    onClose: () => void;
    config: Record<string, string>;
    /** 「在一起」那条正计时。没有纪念日时为 null，此时不显示计时块。 */
    anniversary?: { date: string } | null;
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

export default function LoveLetter({ isOpen, onClose, config, anniversary = null }: LoveLetterProps) {
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

            {/* 「在一起」这件事只有一个来源：纪念日列表里那条正计时。
                以前这里读的是 config.main_timer_date，而首页卡片读的是
                EventTimer 表——**同一件事两个数据源**，值还不一样（config
                那个没设，落到硬编码的 '2025-11-30'，纯日期又被按 UTC 解析），
                于是两处的天数和时分秒都对不上。现在由调用方把那条计时器传
                进来，没有就不显示，而不是编一个日期出来。 */}
            {anniversary && (
                <div className="mt-5 pt-5 border-t border-sunken flex justify-center">
                    <Countdown
                        startDate={anniversary.date}
                        title="我们在一起已经"
                        type="countup"
                    />
                </div>
            )}
        </Modal>
    );
}
