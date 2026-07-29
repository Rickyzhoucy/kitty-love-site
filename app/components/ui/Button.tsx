import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
}

const variantStyles: Record<Variant, string> = {
    primary:
        'bg-accent text-on-accent shadow-lift hover:bg-accent-strong hover:-translate-y-px active:scale-[0.97]',
    secondary:
        'bg-accent-soft text-accent hover:bg-accent/20 active:scale-[0.97]',
    ghost:
        'bg-transparent text-ink-muted hover:bg-sunken hover:text-ink',
    danger:
        'bg-danger/10 text-danger hover:bg-danger hover:text-on-accent active:scale-[0.97]',
};

const sizeStyles: Record<Size, string> = {
    sm: 'h-9 px-4 text-sm rounded-full gap-1.5',
    md: 'h-11 px-6 text-base rounded-full gap-2',
};

/** 全站统一按钮：胶囊形态，触控区 ≥36px(sm)/44px(md)，颜色仅来自 token */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', className, type = 'button', ...props },
    ref
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                'inline-flex items-center justify-center font-medium tracking-wide transition-all duration-200 ease-spring',
                'disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
                variantStyles[variant],
                sizeStyles[size],
                className
            )}
            {...props}
        />
    );
});

export default Button;
