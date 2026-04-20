"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Heart, Upload, Plus, Download, X, Sparkles, Calendar } from 'lucide-react';
import styles from './page.module.css';
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
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const [newPhoto, setNewPhoto] = useState({ caption: '', date: '' });
    const [dragActive, setDragActive] = useState(false);
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
                setPhotos([...uploadedPhotos.reverse(), ...photos]);
                setNewPhoto({ caption: '', date: '' });
                setShowUploadModal(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
                notifyPetExperience(25 * uploadedPhotos.length, 'photo');
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('部分或全部上传失败，请重试');
        } finally {
            setUploading(false);
        }
    };

    // Advanced Masonry rendering using columns (CSS column-count approach)
    return (
        <div className={styles.container}>
            <ParticleBackground particleCount={10} types={['heart', 'petal', 'sparkle']} />

            <header className={styles.header}>
                <div className={styles.headerText}>
                    <h1>
                        <ImageIcon size={32} className={styles.headerIcon} /> 
                        甜蜜画廊 
                        <Sparkles size={24} className={styles.headerSparkle} />
                    </h1>
                    <p>收集每一次心动，定格我们最美的瞬间。</p>
                </div>
            </header>

            {/* Masonry Grid */}
            {loading ? (
                <div className={styles.loadingState}>
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <Heart size={40} color="#ff758c" />
                    </motion.div>
                    <p>正在冲洗照片...</p>
                </div>
            ) : (
                <div className={styles.masonryGrid}>
                    
                    {/* The First Item is the Upload Action Card */}
                    <div className={styles.uploadCardWrapper}>
                        <motion.button
                            className={styles.uploadCard}
                            onClick={() => setShowUploadModal(true)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            <div className={styles.uploadIconCircle}>
                                <Plus size={32} color="#ff758c" />
                            </div>
                            <h3>添加新回忆</h3>
                            <p>上传照片或视频</p>
                        </motion.button>
                    </div>

                    <AnimatePresence>
                        {photos.map((photo, index) => (
                            <motion.div
                                key={photo.id}
                                layout
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className={styles.photoCard}
                                onClick={() => setSelectedPhoto(photo)}
                            >
                                <div className={styles.imageWrapper}>
                                    {photo.url ? (
                                        <img src={photo.url} alt={photo.caption} loading="lazy" />
                                    ) : (
                                        <div className={styles.placeholderImg}>
                                            <Heart color="white" fill="rgba(255,255,255,0.5)" size={48} />
                                        </div>
                                    )}
                                </div>
                                <div className={styles.captionArea}>
                                    <h3>{photo.caption}</h3>
                                    {photo.date && (
                                        <div className={styles.dateLabel}>
                                            <Calendar size={12} /> {photo.date}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {/* Upload Modal Overlay */}
            <AnimatePresence>
                {showUploadModal && (
                    <div className={styles.modalOverlay}>
                        <motion.div 
                            className={styles.modalBackdrop}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => !uploading && setShowUploadModal(false)}
                        />
                        <motion.div 
                            className={styles.modalContent}
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        >
                            <button className={styles.closeBtn} onClick={() => !uploading && setShowUploadModal(false)}>
                                <X size={24} />
                            </button>
                            <h2>上传新的心动瞬间</h2>
                            <form onSubmit={handleUpload} className={styles.uploadForm}>
                                <div className={styles.dragDropArea}>
                                    <Upload size={32} color="#ff758c" />
                                    <p>点击选择照片 (支持多选)</p>
                                    <input type="file" ref={fileInputRef} accept="image/*" multiple required className={styles.hiddenInput} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label>这组照片的故事是？</label>
                                    <input
                                        type="text"
                                        value={newPhoto.caption}
                                        onChange={(e) => setNewPhoto({ ...newPhoto, caption: e.target.value })}
                                        placeholder="例如：第一次一起去游乐园"
                                        required
                                        className={styles.input}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <label>发生在哪一天？</label>
                                    <input
                                        type="date"
                                        value={newPhoto.date}
                                        onChange={(e) => setNewPhoto({ ...newPhoto, date: e.target.value })}
                                        className={styles.input}
                                    />
                                </div>
                                <button type="submit" disabled={uploading} className={styles.submitBtn}>
                                    {uploading ? '上传中，请稍候...' : '✨ 存入回忆画廊'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Lightbox Overlay */}
            <AnimatePresence>
                {selectedPhoto && (
                    <div className={styles.lightboxOverlay}>
                        <motion.div 
                            className={styles.lightboxBackdrop}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedPhoto(null)}
                        />
                        <motion.div
                            className={styles.lightboxContent}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                        >
                            <button className={styles.lightboxCloseBtn} onClick={() => setSelectedPhoto(null)}>
                                <X size={32} />
                            </button>
                            <img src={selectedPhoto.url} alt={selectedPhoto.caption} className={styles.lightboxImage} />
                            <div className={styles.lightboxInfo}>
                                <h2>{selectedPhoto.caption}</h2>
                                {selectedPhoto.date && <p>{selectedPhoto.date}</p>}
                                <a href={selectedPhoto.url} download target="_blank" rel="noopener noreferrer" className={styles.downloadBtn}>
                                    <Download size={18} /> 保存原图
                                </a>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
