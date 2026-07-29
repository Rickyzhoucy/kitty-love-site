import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
    /** 装饰 emoji，默认 🐱 */
    icon?: string;
    title: string;
    hint?: string;
    /** 可选操作区（如「去添加」按钮） */
    action?: ReactNode;
    className?: string;
}

/** 统一空列表占位：柔色圆盘图标 + 衬线标题 */
export default function EmptyState({ icon = '🐱', title, hint, action, className }: EmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
            <span
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-3xl"
                aria-hidden
            >
                {icon}
            </span>
            <p className="font-display text-lg font-semibold text-ink m-0">{title}</p>
            {hint && <p className="text-ink-muted text-sm mt-1.5 mb-0">{hint}</p>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}
