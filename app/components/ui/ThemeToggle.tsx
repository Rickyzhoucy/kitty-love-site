'use client';

import { Moon, Sun } from 'lucide-react';
import { useReducer, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'theme';

// 无外部订阅源：主题变化只由本组件 toggle 触发
const subscribe = () => () => {};
const getSnapshot = () => document.documentElement.dataset.theme === 'dark';
const getServerSnapshot = () => false;

/** 暗色模式切换：data-theme 属性 + localStorage 持久化；首屏主题由 layout 内联脚本恢复 */
export default function ThemeToggle({ className }: { className?: string }) {
    // useSyncExternalStore：hydration 时用 server snapshot（Moon），随后同步到真实主题，无 hydration 错误
    const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    const toggle = () => {
        const next = isDark ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem(STORAGE_KEY, next);
        forceUpdate(); // DOM 已变，触发重渲染让 getSnapshot 读到新值
    };

    return (
        <button
            onClick={toggle}
            aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
            className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink cursor-pointer',
                className
            )}
        >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
    );
}
