"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Check, X, Trash2, Key, ArrowLeft, Shield } from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

interface Admin {
    id: string;
    username: string;
    status: string;
    createdAt: string;
}

export default function AdminManagement() {
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
    const [passwordModal, setPasswordModal] = useState<{ id: string; username: string } | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        fetchAdmins();
        fetchCurrentAdmin();
    }, []);

    const fetchAdmins = async () => {
        try {
            const res = await fetch('/api/admin/manage');
            if (res.ok) {
                setAdmins(await res.json());
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchCurrentAdmin = async () => {
        try {
            const res = await fetch('/api/admin/login');
            if (res.ok) {
                const data = await res.json();
                if (data.authenticated) {
                    setCurrentAdminId(data.adminId);
                }
            }
        } catch (err) {
            console.error('Failed to get current admin', err);
        }
    };

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        try {
            const res = await fetch('/api/admin/manage', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action })
            });
            if (res.ok) {
                const updated = await res.json();
                setAdmins(admins.map(a => a.id === id ? { ...a, status: updated.status } : a));
            }
        } catch (err) {
            console.error('Action failed', err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这个管理员吗？')) return;

        try {
            const res = await fetch(`/api/admin/manage?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setAdmins(admins.filter(a => a.id !== id));
            } else {
                const data = await res.json();
                alert(data.error);
            }
        } catch (err) {
            console.error('Delete failed', err);
        }
    };

    const handlePasswordUpdate = async () => {
        if (!passwordModal || !newPassword.trim()) return;

        setUpdating(true);
        try {
            const res = await fetch('/api/admin/manage', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: passwordModal.id,
                    action: 'updatePassword',
                    newPassword
                })
            });

            if (res.ok) {
                alert('密码已更新');
                setPasswordModal(null);
                setNewPassword('');
            } else {
                const data = await res.json();
                alert(data.error);
            }
        } finally {
            setUpdating(false);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved':
                return <span className={`${styles.badge} ${styles.approved}`}>已通过</span>;
            case 'pending':
                return <span className={`${styles.badge} ${styles.pending}`}>待审核</span>;
            case 'rejected':
                return <span className={`${styles.badge} ${styles.rejected}`}>已拒绝</span>;
            default:
                return null;
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <Users size={28} color="#F48FB1" />
                    <div>
                        <h1>管理员账号管理</h1>
                        <p>审核新注册、修改密码、删除账号</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2><Shield size={20} /> 管理员列表 ({admins.length})</h2>

                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : admins.length === 0 ? (
                    <p className={styles.empty}>还没有管理员账号</p>
                ) : (
                    <div className={styles.list}>
                        <AnimatePresence>
                            {admins.map((admin) => (
                                <motion.div
                                    key={admin.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -50 }}
                                    className={styles.adminItem}
                                >
                                    <div className={styles.adminInfo}>
                                        <div className={styles.username}>
                                            {admin.username}
                                            {admin.id === currentAdminId && (
                                                <span className={styles.currentTag}>当前</span>
                                            )}
                                        </div>
                                        <div className={styles.meta}>
                                            {getStatusBadge(admin.status)}
                                            <span className={styles.date}>
                                                {new Date(admin.createdAt).toLocaleDateString('zh-CN')}
                                            </span>
                                        </div>
                                    </div>

                                    <div className={styles.actions}>
                                        {admin.status === 'pending' && (
                                            <>
                                                <button
                                                    onClick={() => handleAction(admin.id, 'approve')}
                                                    className={styles.approveBtn}
                                                    title="通过"
                                                >
                                                    <Check size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleAction(admin.id, 'reject')}
                                                    className={styles.rejectBtn}
                                                    title="拒绝"
                                                >
                                                    <X size={18} />
                                                </button>
                                            </>
                                        )}

                                        <button
                                            onClick={() => setPasswordModal({ id: admin.id, username: admin.username })}
                                            className={styles.passwordBtn}
                                            title="修改密码"
                                        >
                                            <Key size={18} />
                                        </button>

                                        {admin.id !== currentAdminId && (
                                            <button
                                                onClick={() => handleDelete(admin.id)}
                                                className={styles.deleteBtn}
                                                title="删除"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </section>

            {/* 修改密码弹窗 */}
            {passwordModal && (
                <div className={styles.modalOverlay} onClick={() => setPasswordModal(null)}>
                    <motion.div
                        className={styles.modal}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>修改密码</h3>
                        <p>为 <strong>{passwordModal.username}</strong> 设置新密码</p>
                        <input
                            type="password"
                            placeholder="新密码（至少6位）"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className={styles.modalInput}
                        />
                        <div className={styles.modalActions}>
                            <button onClick={() => setPasswordModal(null)} className={styles.cancelBtn}>
                                取消
                            </button>
                            <button
                                onClick={handlePasswordUpdate}
                                disabled={updating || newPassword.length < 6}
                                className={styles.confirmBtn}
                            >
                                {updating ? '更新中...' : '确认修改'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
