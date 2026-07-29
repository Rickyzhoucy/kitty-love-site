import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    /** glass：毛玻璃变体，仅用于浮层（导航/悬浮卡），内容区用默认不透明 */
    glass?: boolean;
}

/** 统一卡片：大圆角 + 细边 + 暖调柔和阴影 */
const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
    { glass = false, className, ...props },
    ref
) {
    return (
        <div
            ref={ref}
            className={cn(
                'rounded-lg border border-ink/5 shadow-soft',
                glass
                    ? 'bg-surface/75 backdrop-blur-xl'
                    : 'bg-surface',
                className
            )}
            {...props}
        />
    );
});

export default Card;
