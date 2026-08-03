"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, Upload, Plus, Download } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { photosApi, type Photo } from '@/lib/api/resources';
import { uploadAttachment } from '@/lib/api/attachments';
import { useResourceEvents } from '@/lib/api/useResourceEvents';
import FallbackImage from '../components/ui/FallbackImage';

export default function Gallery() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const [newPhoto, setNewPhoto] = useState({ caption: '', date: '' });
    const [fileNames, setFileNames] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const loadPhotos = useCallback(async () => {
        try {
            setPhotos(await photosApi.list());
        } catch (error) {
            console.error('Failed to fetch photos', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPhotos();
    }, [loadPhotos]);
    useResourceEvents(['photos'], () => void loadPhotos());

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        const files = fileInputRef.current?.files;
        if (!files || files.length === 0 || !newPhoto.caption) {
            toast('请选择图片并填写描述', 'error');
            return;
        }

        setUploading(true);
        try {
            const uploadedPhotos: Photo[] = [];
            for (let i = 0; i < files.length; i++) {
                const attachment = await uploadAttachment(files[i]);
                const photo = await photosApi.create({
                    attachmentId: attachment.id,
                    caption: files.length > 1 ? `${newPhoto.caption} (${i + 1})` : newPhoto.caption,
                    date: newPhoto.date || undefined,
                });
                uploadedPhotos.push(photo);
            }

            if (uploadedPhotos.length === 0) throw new Error('全部上传失败');

            setPhotos([...uploadedPhotos.reverse(), ...photos]);
            setNewPhoto({ caption: '', date: '' });
            setFileNames([]);
            setShowUploadForm(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            toast(`成功上传 ${uploadedPhotos.length} 张照片 📷`);
        } catch (error) {
            console.error('Upload error:', error);
            toast('部分或全部上传失败，请重试', 'error');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-6">
            {/* 巨型排版页头 */}
            <header className="mb-10 pt-2 animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-accent m-0">Sweet Memories</p>
                <h1 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[1.05] tracking-wide m-0">
                    <span className="text-ink">甜蜜</span>
                    <span className="text-stroke-accent">回忆</span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-ink-muted mb-0">和你在一起的每一刻都值得珍藏</p>
            </header>

            <div className="mb-5 text-center">
                <Button onClick={() => setShowUploadForm(!showUploadForm)}>
                    <Upload size={16} />
                    {showUploadForm ? '取消' : '上传新照片'}
                </Button>
            </div>

            {showUploadForm && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-8 overflow-hidden"
                >
                    <motion.div
                        initial={{ y: -16 }}
                        animate={{ y: 0 }}
                    >
                    <Card className="p-6">
                        <form onSubmit={handleUpload} className="flex flex-col gap-5">
                            {/* 虚线投放区 */}
                            <label
                                htmlFor="photo-file"
                                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-accent/40 bg-accent-soft/30 px-6 py-10 text-center transition-colors hover:border-accent hover:bg-accent-soft/60"
                            >
                                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-soft">
                                    <Upload size={22} />
                                </span>
                                <span className="font-display text-lg font-semibold text-ink">
                                    点击选择照片
                                </span>
                                <span className="text-sm text-ink-muted">支持多选 · JPG / PNG / WebP</span>
                                {fileNames.length > 0 && (
                                    <span className="mt-1 flex flex-wrap justify-center gap-2">
                                        {fileNames.map((name, i) => (
                                            <span key={i} className="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
                                                {name}
                                            </span>
                                        ))}
                                    </span>
                                )}
                                <input
                                    id="photo-file"
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    multiple
                                    required
                                    className="sr-only"
                                    onChange={(e) => setFileNames(Array.from(e.target.files ?? []).map(f => f.name))}
                                />
                            </label>

                            <div className="flex flex-wrap items-end gap-4">
                                <div className="flex-1 min-w-[200px]">
                                    <label htmlFor="photo-caption" className="block mb-1.5 text-sm text-ink-muted">
                                        描述/标题（批量上传时共用）*
                                    </label>
                                    <Input
                                        id="photo-caption"
                                        type="text"
                                        value={newPhoto.caption}
                                        onChange={(e) => setNewPhoto({ ...newPhoto, caption: e.target.value })}
                                        placeholder="例如：我们的第一次约会"
                                        required
                                    />
                                </div>
                                <div className="w-full sm:w-auto">
                                    <label htmlFor="photo-date" className="block mb-1.5 text-sm text-ink-muted">日期</label>
                                    <Input
                                        id="photo-date"
                                        type="date"
                                        value={newPhoto.date}
                                        onChange={(e) => setNewPhoto({ ...newPhoto, date: e.target.value })}
                                    />
                                </div>
                                <Button type="submit" disabled={uploading}>
                                    {uploading ? '上传中...' : (
                                        <>
                                            <Plus size={16} /> 批量添加到相册
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </Card>
                    </motion.div>
                </motion.div>
            )}

            {loading ? (
                <p className="text-center text-ink-muted py-8">加载回忆中...</p>
            ) : photos.length === 0 ? (
                <EmptyState icon="📷" title="还没有照片哦" hint="快来上传第一张吧！" />
            ) : (
                /* 自然比例瀑布流：图片原始纵横比形成节奏感，hover 升起渐变字幕 */
                <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
                    {photos.map((photo, index) => (
                        <motion.div
                            key={photo.id}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(index * 0.05, 0.5), duration: 0.4 }}
                            className="group relative mb-4 break-inside-avoid cursor-pointer overflow-hidden rounded-lg border border-ink/5 bg-surface shadow-soft transition-shadow duration-300 hover:shadow-lift"
                            onClick={() => setSelectedPhoto(photo)}
                        >
                            {photo.url ? (
                                <FallbackImage
                                    primarySrc={photo.thumbnailUrl}
                                    fallbackSrc={photo.url}
                                    alt={photo.caption}
                                    className="w-full h-auto object-cover transition-transform duration-500 ease-spring group-hover:scale-105"
                                    loading="lazy"
                                    decoding="async"
                                />
                            ) : (
                                <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-accent-soft to-secondary-soft">
                                    <Heart className="text-white/60" fill="currentColor" size={48} />
                                </div>
                            )}
                            {/* hover 渐变字幕 */}
                            <div className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                <h3 className="truncate font-display text-sm font-semibold text-white m-0">{photo.caption}</h3>
                                {photo.date && <span className="shrink-0 text-[11px] tracking-wide text-white/80">{photo.date}</span>}
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Lightbox：统一 Modal（--z-modal，修复与宠物撞层） */}
            <Modal
                open={!!selectedPhoto}
                onOpenChange={(open) => !open && setSelectedPhoto(null)}
                title={selectedPhoto?.caption ?? '查看照片'}
                hideTitle
                className="max-w-3xl bg-transparent shadow-none p-0 overflow-y-visible border-0"
                hideClose
            >
                {selectedPhoto && (
                    <div className="flex flex-col items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={selectedPhoto.url}
                            alt={selectedPhoto.caption}
                            className="max-h-[70dvh] w-auto max-w-full rounded-md object-contain shadow-modal"
                        />
                        <div className="mt-5 text-center text-white">
                            <h2 className="font-display text-2xl font-semibold tracking-wide m-0 [text-shadow:0_1px_12px_rgba(0,0,0,0.6)]">
                                {selectedPhoto.caption}
                            </h2>
                            {selectedPhoto.date && (
                                <p className="mt-1.5 text-sm tracking-wide opacity-80 mb-0 [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">
                                    {selectedPhoto.date}
                                </p>
                            )}
                            <a
                                href={selectedPhoto.url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-4 inline-flex items-center gap-2 rounded-full bg-surface/90 px-5 py-2.5 text-sm font-medium text-ink shadow-lift backdrop-blur-md transition-transform hover:scale-105"
                            >
                                <Download size={16} /> 下载原图
                            </a>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
