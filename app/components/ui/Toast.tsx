'use client';

import * as RadixToast from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error';

interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

interface ToastContextValue {
    toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 在任意组件中调用：const { toast } = useToast(); toast('保存成功'); */
export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用');
    return ctx;
}

let nextId = 0;

/** 替代全站 alert() 的统一提示。挂在 layout 的 body 根部。 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);

    const toast = useCallback((message: string, kind: ToastKind = 'success') => {
        const id = ++nextId;
        setItems((prev) => [...prev.slice(-2), { id, kind, message }]);
    }, []);

    const dismiss = useCallback((id: number) => {
        setItems((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toast }}>
            <RadixToast.Provider swipeDirection="right" duration={3000}>
                {children}
                {items.map((item) => (
                    <RadixToast.Root
                        key={item.id}
                        onOpenChange={(open) => !open && dismiss(item.id)}
                        className={cn(
                            'flex items-center gap-2 rounded-full border border-ink/5 px-5 py-3 shadow-lift bg-surface/90 backdrop-blur-md text-ink',
                            'data-[state=open]:animate-[toast-in_0.25s_ease-out]',
                            'data-[state=closed]:animate-[toast-out_0.2s_ease-in_forwards]',
                            'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
                            'data-[swipe=end]:animate-[toast-out_0.15s_ease-in_forwards]'
                        )}
                    >
                        {item.kind === 'success' ? (
                            <CheckCircle2 size={18} className="text-success shrink-0" />
                        ) : (
                            <AlertCircle size={18} className="text-danger shrink-0" />
                        )}
                        <RadixToast.Description className="text-sm">
                            {item.message}
                        </RadixToast.Description>
                    </RadixToast.Root>
                ))}
                <RadixToast.Viewport className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm outline-none" />
            </RadixToast.Provider>
        </ToastContext.Provider>
    );
}
