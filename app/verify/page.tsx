"use client";

import { useEffect, useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Heart, Lock, LogIn, User, KeyRound, AlertCircle, Fingerprint } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { authApi } from '@/lib/api/auth';
import { explain, isAvailable, loginWithPasskey } from '@/lib/passkey';

function safeRedirect(value: string | null): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function VerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectPath = safeRedirect(searchParams.get('redirect'));
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [passkeyReady, setPasskeyReady] = useState(false);

    // 真的问一句浏览器支不支持，不靠 UA 猜。不支持就整个按钮不显示——
    // 摆一个按下去必然失败的按钮比没有更糟。
    useEffect(() => {
        let cancelled = false;
        void isAvailable().then(ok => { if (!cancelled) setPasskeyReady(ok); });
        return () => { cancelled = true; };
    }, []);

    const signInWithPasskey = async () => {
        setLoading(true);
        setError('');
        try {
            await loginWithPasskey('/auth/passkey');
            router.replace(redirectPath);
            router.refresh();
        } catch (reason) {
            setError(explain(reason));
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!username.trim() || !password) return;

        setLoading(true);
        setError('');
        try {
            await authApi.login(username.trim(), password);
            router.replace(redirectPath);
            router.refresh();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '登录失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-dvh items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-sm"
            >
                <Card className="p-8">
                    <div className="mb-7 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong shadow-lift">
                            <Lock size={26} className="text-on-accent" />
                        </div>
                        <h1 className="font-display text-2xl font-semibold tracking-wide text-ink m-0">欢迎回来</h1>
                        <p className="mt-2 text-sm text-ink-muted mb-0">登录我们的私人空间</p>
                    </div>

                    {error && (
                        <motion.p
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-4 flex items-center gap-2 rounded-md bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
                            role="alert"
                        >
                            <AlertCircle size={16} className="shrink-0" />
                            {error}
                        </motion.p>
                    )}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="relative">
                            <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                            <Input
                                value={username}
                                onChange={event => setUsername(event.target.value)}
                                placeholder="用户名"
                                aria-label="用户名"
                                autoComplete="username"
                                className="pl-9"
                                disabled={loading}
                                autoFocus
                            />
                        </div>
                        <div className="relative">
                            <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                            <Input
                                type="password"
                                value={password}
                                onChange={event => setPassword(event.target.value)}
                                placeholder="密码"
                                aria-label="密码"
                                autoComplete="current-password"
                                className="pl-9"
                                disabled={loading}
                            />
                        </div>
                        <Button type="submit" disabled={loading || !username.trim() || !password} className="w-full">
                            <LogIn size={16} />
                            {loading ? '登录中…' : '登录'}
                        </Button>
                    </form>

                    {passkeyReady && (
                        <>
                            <div className="my-4 flex items-center gap-3">
                                <span className="h-px flex-1 bg-ink/10" />
                                <span className="text-xs text-ink-muted">或者</span>
                                <span className="h-px flex-1 bg-ink/10" />
                            </div>
                            <button
                                type="button"
                                onClick={signInWithPasskey}
                                disabled={loading}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/30 px-4 py-2.5 text-sm text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                <Fingerprint size={17} />
                                用这台设备登录
                            </button>
                            <p className="mb-0 mt-2 text-center text-[11px] text-ink-muted">
                                还没设置？登录后去 <code className="rounded bg-sunken px-1">/settings</code> 加一把。
                            </p>
                        </>
                    )}

                    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-muted">
                        <Heart size={12} className="text-accent" fill="currentColor" />
                        <span>只属于我们的生活空间</span>
                        <Heart size={12} className="text-accent" fill="currentColor" />
                    </div>
                </Card>
            </motion.div>
        </div>
    );
}

export default function VerifyPage() {
    return (
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-ink-muted">加载中...</div>}>
            <VerifyContent />
        </Suspense>
    );
}
