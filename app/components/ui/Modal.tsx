'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 对话框标题：无障碍必填，Radix Dialog.Title；hideTitle 时视觉隐藏 */
    title: string;
    /** 视觉隐藏标题（如 Lightbox 自带标题文案） */
    hideTitle?: boolean;
    children: ReactNode;
    /** 内容区额外类名 */
    className?: string;
    /** 隐藏右上角关闭按钮（如 Lightbox 自带关闭） */
    hideClose?: boolean;
}

/**
 * 统一模态框：Radix Dialog 提供 focus trap / ESC / ARIA（含 Dialog.Title），
 * framer-motion 提供进出场动画，z-index 统一 --z-modal。
 */
export default function Modal({ open, onOpenChange, title, hideTitle, children, className, hideClose }: ModalProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <AnimatePresence>
                {open && (
                    <Dialog.Portal forceMount>
                        <Dialog.Overlay asChild forceMount>
                            <motion.div
                                className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[var(--z-modal)]"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                            />
                        </Dialog.Overlay>
                        <Dialog.Content asChild forceMount>
                            <motion.div
                                className={cn(
                                    'fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[calc(100vw-2rem)] max-w-md',
                                    'bg-surface rounded-lg shadow-modal p-6',
                                    'max-h-[90dvh] overflow-y-auto',
                                    className
                                )}
                                initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-48%' }}
                                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                                exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-48%' }}
                                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <Dialog.Title
                                    className={cn(
                                        'font-display text-xl font-semibold tracking-wide text-center text-ink mt-0 mb-5',
                                        hideTitle && 'sr-only'
                                    )}
                                >
                                    {title}
                                </Dialog.Title>
                                {!hideClose && (
                                    <Dialog.Close asChild>
                                        <button
                                            aria-label="关闭"
                                            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-ink-muted transition-all hover:bg-accent hover:text-on-accent hover:rotate-90 cursor-pointer"
                                        >
                                            <X size={18} />
                                        </button>
                                    </Dialog.Close>
                                )}
                                {children}
                            </motion.div>
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
            </AnimatePresence>
        </Dialog.Root>
    );
}
