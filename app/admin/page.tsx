"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import styles from './page.module.css';

export default function AdminLogin() {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const router = useRouter();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        // Simple PIN check - hardcoded for this gift project
        // In a real app, verify against API/DB
        if (pin === '0520') { // Example date: May 20
            document.cookie = "admin_auth=true; path=/";
            router.push('/admin/dashboard');
        } else {
            setError('PIN 错误');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.iconWrapper}>
                    <Lock size={32} color="#F48FB1" />
                </div>
                <h1>管理员登录</h1>
                <p>请输入专属 PIN 码</p>

                <form onSubmit={handleLogin} className={styles.form}>
                    <input
                        type="password"
                        value={pin}
                        onChange={(e) => {
                            setPin(e.target.value);
                            setError('');
                        }}
                        placeholder="PIN"
                        maxLength={4}
                        className={styles.input}
                    />
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" className={styles.button}>
                        解锁
                    </button>
                </form>
            </div>
        </div>
    );
}
