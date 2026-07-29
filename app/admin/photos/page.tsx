"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Image as ImageIcon, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import styles from '../questions/page.module.css';
import { photosApi, type Photo } from '@/lib/api/resources';
import { useToast } from '@/app/components/ui/Toast';

export default function PhotosManagement() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        fetchPhotos();
    }, []);

    const fetchPhotos = async () => {
        try {
            setPhotos(await photosApi.list());
        } catch (err) {
            console.error('Failed to fetch photos', err);
        } finally {
            setLoading(false);
        }
    };

    const confirmDelete = async (id: string) => {
        try {
            await photosApi.remove(id);
            setPhotos(photos.filter(p => p.id !== id));
            setDeletingId(null);
        } catch {
            toast('删除失败', 'error');
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <ImageIcon size={28} color="#FFB74D" />
                    <div>
                        <h1>照片墙管理</h1>
                        <p>管理珍贵的照片回忆</p>
                    </div>
                </div>
            </header>

            <section className={styles.listSection}>
                <h2>已有照片 ({photos.length})</h2>
                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : photos.length === 0 ? (
                    <p className={styles.empty}>暂无照片</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                        <AnimatePresence>
                            {photos.map((p) => (
                                <motion.div
                                    key={p.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    style={{
                                        background: 'white', borderRadius: '12px', overflow: 'hidden',
                                        border: '1px solid #eee', position: 'relative'
                                    }}
                                >
                                    <div style={{ aspectRatio: '1', position: 'relative', overflow: 'hidden' }}>
                                        {p.url ? (
                                            <Image src={p.url} alt={p.caption} fill sizes="200px" unoptimized style={{ objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{ width: '100%', height: '100%', background: '#FFF3E0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFB74D' }}>
                                                <ImageIcon size={40} />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ padding: '0.8rem' }}>
                                        <p style={{ margin: '0 0 0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>{p.caption}</p>
                                        <small style={{ color: '#90A4AE' }}>{p.date}</small>

                                        <div style={{ marginTop: '0.8rem' }}>
                                            {deletingId === p.id ? (
                                                <div className={styles.confirmDelete} style={{ justifyContent: 'center' }}>
                                                    <button onClick={() => confirmDelete(p.id)} className={styles.confirmBtn}>确定</button>
                                                    <button onClick={() => setDeletingId(null)} className={styles.cancelBtn}>取消</button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setDeletingId(p.id)}
                                                    className={styles.deleteBtn}
                                                    style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                                                >
                                                    <Trash2 size={18} /> 删除
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </section>
        </div>
    );
}
