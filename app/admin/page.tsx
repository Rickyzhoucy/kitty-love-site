"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User, KeyRound, AlertCircle, UserPlus, LogIn } from 'lucide-react';
import styles from './page.module.css';

export default function AdminLogin() {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password.trim()) {
            setError('请输入用户名和密码');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || '登录失败');
                return;
            }

            router.push('/admin/dashboard');
            router.refresh();

        } catch {
            setError('网络错误，请重试');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password.trim()) {
            setError('请输入用户名和密码');
            return;
        }

        if (password !== confirmPassword) {
            setError('两次输入的密码不一致');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const res = await fetch('/api/admin/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || '注册失败');
                return;
            }

            setSuccess(data.message);
            setUsername('');
            setPassword('');
            setConfirmPassword('');

            // 如果是第一个管理员且自动通过，切换到登录
            if (data.admin?.status === 'approved') {
                setTimeout(() => {
                    setMode('login');
                    setSuccess('');
                }, 2000);
            }

        } catch {
            setError('网络错误，请重试');
        } finally {
            setLoading(false);
        }
    };

    const switchMode = () => {
        setMode(mode === 'login' ? 'register' : 'login');
        setError('');
        setSuccess('');
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.iconWrapper}>
                    {mode === 'login' ? (
                        <Lock size={32} color="#F48FB1" />
                    ) : (
                        <UserPlus size={32} color="#F48FB1" />
                    )}
                </div>
                <h1>{mode === 'login' ? '管理员登录' : '注册管理员'}</h1>
                <p>{mode === 'login' ? '请使用管理员账号登录' : '首位注册自动成为管理员'}</p>

                <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <User size={18} className={styles.inputIcon} />
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setError('');
                            }}
                            placeholder="用户名"
                            className={styles.input}
                            disabled={loading}
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <KeyRound size={18} className={styles.inputIcon} />
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError('');
                            }}
                            placeholder="密码"
                            className={styles.input}
                            disabled={loading}
                        />
                    </div>

                    {mode === 'register' && (
                        <div className={styles.inputGroup}>
                            <KeyRound size={18} className={styles.inputIcon} />
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="确认密码"
                                className={styles.input}
                                disabled={loading}
                            />
                        </div>
                    )}

                    {error && (
                        <p className={styles.error}>
                            <AlertCircle size={16} />
                            {error}
                        </p>
                    )}

                    {success && (
                        <p className={styles.success}>
                            {success}
                        </p>
                    )}

                    <button
                        type="submit"
                        className={styles.button}
                        disabled={loading}
                    >
                        {loading ? (mode === 'login' ? '登录中...' : '注册中...') : (
                            <>
                                {mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
                                {mode === 'login' ? '登录' : '注册'}
                            </>
                        )}
                    </button>
                </form>

                <button onClick={switchMode} className={styles.switchBtn}>
                    {mode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
                </button>
            </div>
        </div>
    );
}
