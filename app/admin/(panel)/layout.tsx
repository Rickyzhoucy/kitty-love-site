'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
    Brain,
    Cable,
    Gauge,
    Image as ImageIcon,
    LogOut,
    Puzzle,
    Settings2,
    ShieldCheck,
    Users,
} from 'lucide-react';
import { adminApi, type AdminMe } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 后台外壳：导航 + 登录校验。
 *
 * ## 这里管什么，不管什么
 *
 * 照片、里程碑、留言这些**主站自己就能编辑**，后台不再重做一遍——两套 UI
 * 维护同一批数据，改一处忘一处是迟早的事。所以导航里只有主站碰不到的东西：
 * 配置、记忆、技能、账号、首页素材。
 *
 * （改造前后台有 7 个内容页，和主站功能重复；那几个页面这一版删掉了。）
 */

const NAV = [
    { href: '/admin/overview', label: '总览', icon: Gauge },
    { href: '/admin/system', label: '系统配置', icon: Settings2 },
    { href: '/admin/memories', label: '记忆', icon: Brain },
    { href: '/admin/skills', label: '技能与调用', icon: Puzzle },
    { href: '/admin/capabilities', label: 'MCP 能力', icon: Cable },
    { href: '/admin/hero', label: '首页素材', icon: ImageIcon },
    { href: '/admin/accounts', label: '账号', icon: Users },
] as const;

export default function PanelLayout({ children }: { children: React.ReactNode }) {
    const [me, setMe] = useState<AdminMe | null>(null);
    const [checked, setChecked] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        adminApi.me()
            .then(admin => { if (!cancelled) setMe(admin); })
            // 401 时 client.ts 已经把人送回 /admin 了，这里不用再跳一次。
            .catch(() => undefined)
            .finally(() => { if (!cancelled) setChecked(true); });
        return () => { cancelled = true; };
    }, []);

    const signOut = useCallback(async () => {
        await adminApi.logout().catch(() => undefined);
        router.replace('/admin');
    }, [router]);

    if (!checked) {
        return (
            <div className="flex min-h-dvh items-center justify-center text-sm text-ink-muted">
                正在确认身份…
            </div>
        );
    }

    return (
        <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
            <aside className="md:w-52 md:shrink-0">
                <div className="mb-4 flex items-center gap-2 px-1">
                    <ShieldCheck size={18} className="text-accent" />
                    <span className="font-display text-lg text-ink">后台</span>
                </div>

                <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
                    {NAV.map(({ href, label, icon: Icon }) => {
                        const active = pathname === href;
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={cn(
                                    'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                                    active
                                        ? 'bg-accent text-on-accent'
                                        : 'text-ink-muted hover:bg-sunken/60 hover:text-ink',
                                )}
                            >
                                <Icon size={16} />
                                {label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="mt-4 hidden border-t border-ink/5 pt-4 md:block">
                    <p className="m-0 px-3 text-xs text-ink-muted">
                        登录为 <span className="text-ink">{me?.username ?? '—'}</span>
                    </p>
                    <button
                        type="button"
                        onClick={signOut}
                        className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-sunken/60 hover:text-danger"
                    >
                        <LogOut size={16} />
                        退出
                    </button>
                </div>
            </aside>

            <main className="min-w-0 flex-1">{children}</main>
        </div>
    );
}
