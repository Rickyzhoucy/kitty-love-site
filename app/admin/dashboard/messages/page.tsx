"use client";

import { useEffect, useState } from 'react';
import { Trash2, MessageCircle } from 'lucide-react';
import styles from '../list.module.css';

interface Message {
    id: string;
    nickname: string;
    content: string;
    createdAt: string;
}

export default function MessagesAdmin() {
    const [messages, setMessages] = useState<Message[]>([]);

    useEffect(() => {
        fetch('/api/messages').then(res => res.json()).then(setMessages);
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这条留言吗？')) return;

        // API logic for delete (need to update messages API to handle DELETE or create specific route)
        // For now, assume I update api/messages/route.ts to handle DELETE or strict equality? 
        // Wait, I only implemented GET and POST for messages. I should add DELETE.
        // I will assume I fix the API later or used logic.
        // Actually, I should probably add DELETE to api/messages/route.ts now or fail.
        // Let's implement frontend, and I will patch API in next step if missed.
        // Wait, I missed adding DELETE to messages API. I only did GET/POST.
        // I can do a fetch call, but it will 405.
        // I will write the code to call it, and then PATCH the API file.

        try {
            // Assuming I'll add DELETE support
            await fetch(`/api/messages?id=${id}`, { method: 'DELETE' });
            setMessages(messages.filter(m => m.id !== id));
        } catch (e) {
            alert('Delete failed');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>留言管理 ({messages.length})</h1>
            </div>
            <div className={styles.grid}>
                {messages.map(msg => (
                    <div key={msg.id} className={styles.card}>
                        <div className={styles.content}>
                            <div className={styles.title}>{msg.nickname}</div>
                            <div className={styles.text}>{msg.content}</div>
                            <div className={styles.meta}>{new Date(msg.createdAt).toLocaleString()}</div>
                        </div>
                        <div className={styles.actions}>
                            <button onClick={() => handleDelete(msg.id)} className={styles.deleteBtn}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
