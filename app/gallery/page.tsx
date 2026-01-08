"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Heart, Upload, Plus, Download, X } from 'lucide-react';
import styles from './page.module.css';
import KittyStickers from '../components/KittyStickers';
import ParticleBackground from '../components/ParticleBackground';
import { notifyPetExperience } from '@/lib/petEvents';

interface Photo {
    id: string;
    url: string;
    caption: string;
    date?: string;
}

export default function Gallery() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const [newPhoto, setNewPhoto] = useState({ caption: '', date: '' });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchPhotos();
    }, []);

    const fetchPhotos = async () => {
        try {
            const res = await fetch('/api/photos');
            if (res.ok) {
                setPhotos(await res.json());
            }
        } catch (error) {
            console.error('Failed to fetch photos', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        const files = fileInputRef.current?.files;
        if (!files || files.length === 0 || !newPhoto.caption) {
            alert('请选择图片并填写描述');
            return;
        }

        setUploading(true);
        try {
            const uploadedPhotos = [];
            // Batch upload loop
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const formData = new FormData();
                formData.append('file', file);

                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                });

                if (uploadRes.ok) {
                    const { url } = await uploadRes.json();

                    // Create record
                    const photoRes = await fetch('/api/photos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url,
                            caption: files.length > 1 ? `${newPhoto.caption} (${i + 1})` : newPhoto.caption,
                            date: newPhoto.date,
                        }),
                    });

                    if (photoRes.ok) {
                        uploadedPhotos.push(await photoRes.json());
                    }
                }
            }

            if (uploadedPhotos.length > 0) {
                setPhotos([...uploadedPhotos.reverse(), ...photos]); // Add new ones to top
                setNewPhoto({ caption: '', date: '' });
                setShowUploadForm(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
                notifyPetExperience(25 * uploadedPhotos.length, 'photo');
                alert(`成功上传 ${uploadedPhotos.length} 张照片`);
            } else {
                throw new Error('No photos uploaded successfully');
            }

        } catch (error) {
            console.error('Upload error:', error);
            alert('部分或全部上传失败，请重试');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* 动态贴纸和粒子效果 */}
            <KittyStickers count={6} />
            <ParticleBackground particleCount={10} types={['heart', 'petal', 'sparkle']} />

            <header className={styles.header}>
                <img
                    src="https://upload.wikimedia.org/wikipedia/en/0/05/Hello_kitty_character_portrait.png"
                    alt="Hello Kitty"
                    className={styles.kittyIcon}
                />
                <div>
                    <h1><ImageIcon className={styles.icon} /> 甜蜜回忆</h1>
                    <p>和你在一起的每一刻都值得珍藏。</p>
                </div>
            </header>

            {/* Upload Button */}
            <div className={styles.uploadSection}>
                <button
                    onClick={() => setShowUploadForm(!showUploadForm)}
                    className={styles.uploadBtn}
                >
                    <Upload size={18} /> {showUploadForm ? '取消' : '上传新照片'}
                </button>
            </div>

            {/* Upload Form */}
            {showUploadForm && (
                <motion.form
                    onSubmit={handleUpload}
                    className={styles.uploadForm}
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className={styles.formGroup}>
                        <label>选择图片 (支持多选) *</label>
                        <input type="file" ref={fileInputRef} accept="image/*" multiple required />
                    </div>
                    <div className={styles.formGroup}>
                        <label>描述/标题 (批量上传时共用) *</label>
                        <input
                            type="text"
                            value={newPhoto.caption}
                            onChange={(e) => setNewPhoto({ ...newPhoto, caption: e.target.value })}
                            placeholder="例如：我们的第一次约会"
                            required
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>日期</label>
                        <input
                            type="date"
                            value={newPhoto.date}
                            onChange={(e) => setNewPhoto({ ...newPhoto, date: e.target.value })}
                        />
                    </div>
                    <button type="submit" disabled={uploading} className={styles.submitBtn}>
                        {uploading ? '上传中...' : <><Plus size={16} /> 批量添加到相册</>}
                    </button>
                </motion.form>
            )}

            {loading ? (
                <p className={styles.loading}>加载回忆中...</p>
            ) : (
                <div className={styles.grid}>
                    {photos.length === 0 ? (
                        <p className={styles.empty}>还没有照片哦，快来上传吧！</p>
                    ) : (
                        photos.map((photo, index) => (
                            <motion.div
                                key={photo.id}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: index * 0.1 }}
                                className={styles.polaroid}
                                whileHover={{ scale: 1.05, rotate: 0, zIndex: 10 }}
                                style={{ rotate: index % 2 === 0 ? '3deg' : '-3deg', cursor: 'pointer' }}
                                onClick={() => setSelectedPhoto(photo)}
                            >
                                <div className={styles.imagePlaceholder}>
                                    {photo.url ? (
                                        <img src={photo.url} alt={photo.caption} className={styles.photoImg} />
                                    ) : (
                                        <>
                                            <Heart color="white" fill="rgba(255,255,255,0.5)" size={48} />
                                            <span className={styles.placeholderText}>No Image</span>
                                        </>
                                    )}
                                </div>
                                <div className={styles.caption}>
                                    <h3>{photo.caption}</h3>
                                    <span className={styles.date}>{photo.date}</span>
                                </div>
                                {/* Hello Kitty Bow Decoration */}
                                <span className={styles.bowDecoration}>🎀</span>
                            </motion.div>
                        ))
                    )}
                </div>
            )}

            {/* Lightbox Overlay */}
            <AnimatePresence>
                {selectedPhoto && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.9)', zIndex: 9999,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexDirection: 'column', padding: '20px'
                        }}
                        onClick={() => setSelectedPhoto(null)}
                    >
                        <button
                            onClick={() => setSelectedPhoto(null)}
                            style={{
                                position: 'absolute', top: '20px', right: '20px',
                                background: 'transparent', border: 'none', color: 'white',
                                cursor: 'pointer', padding: '10px'
                            }}
                        >
                            <X size={32} />
                        </button>

                        <motion.img
                            src={selectedPhoto.url}
                            alt={selectedPhoto.caption}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            style={{ maxWidth: '90%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '4px' }}
                            onClick={(e) => e.stopPropagation()}
                        />

                        <div style={{ marginTop: '20px', textAlign: 'center', color: 'white' }} onClick={(e) => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{selectedPhoto.caption}</h2>
                            <p style={{ opacity: 0.8, marginBottom: '15px' }}>{selectedPhoto.date}</p>
                            <a
                                href={selectedPhoto.url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                                    background: 'white', color: 'black', padding: '10px 20px',
                                    borderRadius: '20px', textDecoration: 'none', fontWeight: 'bold'
                                }}
                            >
                                <Download size={20} /> 下载原图
                            </a>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
