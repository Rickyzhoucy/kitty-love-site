import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

const baseStyles =
    'w-full rounded-md border border-sunken bg-sunken/40 px-4 py-2.5 text-ink placeholder:text-ink-muted/70 ' +
    'outline-none transition-all duration-200 focus:border-accent focus:bg-surface focus:shadow-soft disabled:opacity-50';

/** 统一输入框：填充式，聚焦时浮起为白底 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function Input({ className, ...props }, ref) {
        return <input ref={ref} className={cn(baseStyles, className)} {...props} />;
    }
);

/** 统一多行输入框 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea({ className, rows = 3, ...props }, ref) {
        return <textarea ref={ref} rows={rows} className={cn(baseStyles, 'resize-y', className)} {...props} />;
    }
);
