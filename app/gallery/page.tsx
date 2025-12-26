"use client";

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Image as ImageIcon, Heart, Upload, Plus } from 'lucide-react';
import styles from './page.module.css';

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
        const file = fileInputRef.current?.files?.[0];
        if (!file || !newPhoto.caption) {
            alert('请选择图片并填写描述');
            return;
        }

        setUploading(true);
        try {
            // 1. Upload file
            const formData = new FormData();
            formData.append('file', file);

            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!uploadRes.ok) throw new Error('Upload failed');

            const { url } = await uploadRes.json();

            // 2. Save photo record to database
            const photoRes = await fetch('/api/photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    caption: newPhoto.caption,
                    date: newPhoto.date,
                }),
            });

            if (photoRes.ok) {
                const savedPhoto = await photoRes.json();
                setPhotos([savedPhoto, ...photos]);
                setNewPhoto({ caption: '', date: '' });
                setShowUploadForm(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('上传失败，请重试');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={styles.container}>
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
                        <label>选择图片 *</label>
                        <input type="file" ref={fileInputRef} accept="image/*" required />
                    </div>
                    <div className={styles.formGroup}>
                        <label>描述/标题 *</label>
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
                        {uploading ? '上传中...' : <><Plus size={16} /> 添加到相册</>}
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
                                style={{ rotate: index % 2 === 0 ? '3deg' : '-3deg' }}
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
        </div>
    );
}
