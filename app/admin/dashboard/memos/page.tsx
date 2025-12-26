"use client";

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import styles from '../list.module.css';

interface Memo {
    id: string;
    category: string;
    text: string;
    completed: boolean;
    createdAt: string;
}

export default function MemosAdmin() {
    const [memos, setMemos] = useState<Memo[]>([]);

    useEffect(() => {
        fetch('/api/memos').then(res => res.json()).then(setMemos);
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除吗？')) return;
        await fetch(`/api/memos?id=${id}`, { method: 'DELETE' });
        setMemos(memos.filter(m => m.id !== id));
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>备忘录管理 ({memos.length})</h1>
            </div>
            <div className={styles.grid}>
                {memos.map(memo => (
                    <div key={memo.id} className={styles.card}>
                        <div className={styles.content}>
                            <div className={styles.title}>{memo.text}</div>
                            <div className={styles.meta}>
                                {memo.category} • {memo.completed ? '已完成' : '未完成'} • {new Date(memo.createdAt).toLocaleDateString()}
                            </div>
                        </div>
                        <div className={styles.actions}>
                            <button onClick={() => handleDelete(memo.id)} className={styles.deleteBtn}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
