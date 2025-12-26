"use client";

import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import styles from '../list.module.css';

interface Milestone {
    id: string;
    title: string;
    date: string;
    description: string;
}

export default function MilestonesAdmin() {
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [newMilestone, setNewMilestone] = useState({ title: '', date: '', description: '' });

    useEffect(() => {
        fetch('/api/milestones').then(res => res.json()).then(setMilestones);
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Delete?')) return;
        await fetch(`/api/milestones?id=${id}`, { method: 'DELETE' });
        setMilestones(milestones.filter(m => m.id !== id));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/milestones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newMilestone)
        });
        if (res.ok) {
            const added = await res.json();
            setMilestones([...milestones, added].sort((a, b) => a.date.localeCompare(b.date)));
            setNewMilestone({ title: '', date: '', description: '' });
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>里程碑管理</h1>
            </div>

            <form onSubmit={handleSubmit} className={styles.addForm}>
                <div className={styles.inputGroup}>
                    <label>标题</label>
                    <input
                        value={newMilestone.title}
                        onChange={e => setNewMilestone({ ...newMilestone, title: e.target.value })}
                        required
                        placeholder="我们在一起啦"
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label>日期</label>
                    <input
                        type="date"
                        value={newMilestone.date}
                        onChange={e => setNewMilestone({ ...newMilestone, date: e.target.value })}
                        required
                    />
                </div>
                <div className={styles.inputGroup} style={{ flexBasis: '100%' }}>
                    <label>描述</label>
                    <input
                        value={newMilestone.description}
                        onChange={e => setNewMilestone({ ...newMilestone, description: e.target.value })}
                        placeholder="那一天阳光很好..."
                        style={{ width: '100%' }}
                    />
                </div>
                <button type="submit" className={styles.submitBtn}>
                    <Plus size={16} /> 添加事件
                </button>
            </form>

            <div className={styles.grid}>
                {milestones.map(m => (
                    <div key={m.id} className={styles.card}>
                        <div className={styles.content}>
                            <div className={styles.title}>{m.title}</div>
                            <div className={styles.text}>{m.description}</div>
                            <div className={styles.meta}>{m.date}</div>
                        </div>
                        <div className={styles.actions}>
                            <button onClick={() => handleDelete(m.id)} className={styles.deleteBtn}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
