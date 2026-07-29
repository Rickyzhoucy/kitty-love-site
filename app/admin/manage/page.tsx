"use client";

import { useEffect, useState } from 'react';
import { ArrowLeft, User } from 'lucide-react';
import Link from 'next/link';
import { authApi, type SessionUser } from '@/lib/api/auth';
import styles from './page.module.css';

export default function AccountOverview() {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        authApi.me()
            .then(setUser)
            .catch(reason => setError(reason instanceof Error ? reason.message : '账号信息加载失败'));
    }, []);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <User size={28} color="#F48FB1" />
                    <div>
                        <h1>当前账号</h1>
                        <p>主站与管理页面共用同一登录会话</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                {error ? (
                    <p className={styles.empty}>{error}</p>
                ) : !user ? (
                    <p className={styles.loading}>加载中...</p>
                ) : (
                    <div className={styles.adminItem}>
                        <div className={styles.adminInfo}>
                            <strong className={styles.username}>{user.displayName}</strong>
                            <p>@{user.username}</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
