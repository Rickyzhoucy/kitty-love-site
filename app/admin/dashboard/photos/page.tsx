"use client";

import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import styles from '../list.module.css';

interface Photo {
    id: string;
    url: string;
    caption: string;
    date: string;
}

export default function PhotosAdmin() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [newPhoto, setNewPhoto] = useState({ url: '', caption: '', date: '' });

    useEffect(() => {
        fetch('/api/photos').then(res => res.json()).then(setPhotos);
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Delete?')) return;
        await fetch(`/api/photos?id=${id}`, { method: 'DELETE' });
        setPhotos(photos.filter(p => p.id !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPhoto)
        });
        if (res.ok) {
            const added = await res.json();
            setPhotos([added, ...photos]);
            setNewPhoto({ url: '', caption: '', date: '' });
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>照片墙管理</h1>
            </div>

            <form onSubmit={handleSubmit} className={styles.addForm}>
                <div className={styles.inputGroup}>
                    <label>图片链接 URL</label>
                    <input
                        value={newPhoto.url}
                        onChange={e => setNewPhoto({ ...newPhoto, url: e.target.value })}
                        placeholder="https://..."
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label>描述/标题</label>
                    <input
                        value={newPhoto.caption}
                        onChange={e => setNewPhoto({ ...newPhoto, caption: e.target.value })}
                        required
                        placeholder="第一次约会..."
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label>日期</label>
                    <input
                        type="date"
                        value={newPhoto.date}
                        onChange={e => setNewPhoto({ ...newPhoto, date: e.target.value })}
                    />
                </div>
                <button type="submit" className={styles.submitBtn}>
                    <Plus size={16} /> 添加照片
                </button>
            </form>

            <div className={styles.grid}>
                {photos.map(p => (
                    <div key={p.id} className={styles.card}>
                        <img src={p.url || 'https://placehold.co/50'} alt={p.caption} style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, marginRight: 10 }} />
                        <div className={styles.content}>
                            <div className={styles.title}>{p.caption}</div>
                            <div className={styles.meta}>{p.date}</div>
                        </div>
                        <div className={styles.actions}>
                            <button onClick={() => handleDelete(p.id)} className={styles.deleteBtn}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
