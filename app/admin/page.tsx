"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, User, KeyRound, AlertCircle, LogIn } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { adminApi } from '@/lib/api/admin';

/**
 * 后台登录。**用的是后台自己的账号，不是主站那对。**
 *
 * 改这一版之前，这个页面上写着「与主站使用同一个账号」，走的也确实是主站的
 * `authApi.login`——那意味着任何能登进主站看照片的人，也能改模型配置、翻全部
 * 记忆、看会话列表。两件事的风险等级差得远。
 *
 * 后台账号用 `python -m app.cli create-admin <用户名> --password <密码>` 建。
 */
export default function AdminLogin() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!username.trim() || !password) {
            setError('请输入用户名和密码');
            return;
        }

        setLoading(true);
        setError('');
        try {
            await adminApi.login(username.trim(), password);
            router.replace('/admin/overview');
            router.refresh();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '登录失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-dvh items-center justify-center p-4">
            <Card className="w-full max-w-sm p-6">
                <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
                        <ShieldCheck size={26} className="text-accent" />
                    </div>
                    <h1 className="text-xl font-bold text-ink m-0">后台</h1>
                    <p className="mt-1 text-sm text-ink-muted mb-0">独立账号，与主站不通用</p>
                </div>

                <form onSubmit={handleLogin} className="flex flex-col gap-3">
                    <div className="relative">
                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
                        <Input
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            placeholder="用户名"
                            aria-label="用户名"
                            autoComplete="username"
                            className="pl-9"
                            disabled={loading}
                        />
                    </div>
                    <div className="relative">
                        <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
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

                    {error && (
                        <p className="flex items-center gap-1.5 text-sm text-danger m-0" role="alert">
                            <AlertCircle size={16} className="shrink-0" />
                            {error}
                        </p>
                    )}

                    <Button type="submit" disabled={loading || !username.trim() || !password} className="w-full mt-1">
                        <LogIn size={16} />
                        {loading ? '登录中…' : '登录'}
                    </Button>
                </form>

                <p className="mb-0 mt-5 text-center text-xs leading-relaxed text-ink-muted">
                    还没有后台账号？在服务器上跑
                    <br />
                    <code className="mt-1 inline-block rounded bg-sunken px-1.5 py-0.5">
                        app.cli create-admin 用户名 --password …
                    </code>
                </p>
            </Card>
        </div>
    );
}
