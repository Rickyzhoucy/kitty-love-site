"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, HelpCircle, Lock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

interface Question {
    id: string;
    question: string;
    hint?: string;
    createdAt: string;
}

export default function QuestionsManagement() {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(true);
    const [newQuestion, setNewQuestion] = useState('');
    const [newAnswer, setNewAnswer] = useState('');
    const [newHint, setNewHint] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        fetchQuestions();
    }, []);

    const fetchQuestions = async () => {
        try {
            const res = await fetch('/api/admin/questions');
            if (res.ok) {
                setQuestions(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch questions', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newQuestion.trim() || !newAnswer.trim()) {
            setError('请填写问题和答案');
            return;
        }

        setAdding(true);
        setError('');

        try {
            const res = await fetch('/api/admin/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: newQuestion,
                    answer: newAnswer,
                    hint: newHint
                })
            });

            if (res.ok) {
                const added = await res.json();
                setQuestions([added, ...questions]);
                setNewQuestion('');
                setNewAnswer('');
                setNewHint('');
            } else {
                const data = await res.json();
                setError(data.error || '添加失败');
            }
        } catch {
            setError('网络错误');
        } finally {
            setAdding(false);
        }
    };

    const confirmDelete = async (id: string) => {
        console.log('Sending delete request for id:', id);
        try {
            const res = await fetch(`/api/admin/questions?id=${id}`, {
                method: 'DELETE'
            });
            console.log('Delete response status:', res.status);

            if (res.ok) {
                console.log('Delete successful');
                setQuestions(questions.filter(q => q.id !== id));
                setDeletingId(null);
            } else {
                const errData = await res.json();
                console.error('Delete failed:', errData);
                alert('删除失败: ' + (errData.error || '未知错误'));
            }
        } catch (err) {
            console.error('Failed to delete', err);
            alert('删除发生错误');
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} />
                    返回
                </Link>
                <div className={styles.headerContent}>
                    <Lock size={28} color="#F48FB1" />
                    <div>
                        <h1>安全问题管理</h1>
                        <p>添加或删除用于验证身份的问题</p>
                    </div>
                </div>
            </header>

            <section className={styles.formSection}>
                <h2><Plus size={20} /> 添加新问题</h2>
                <form onSubmit={handleAdd} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <label>问题</label>
                        <input
                            type="text"
                            value={newQuestion}
                            onChange={(e) => setNewQuestion(e.target.value)}
                            placeholder="例如：我们第一次见面是在哪里？"
                            disabled={adding}
                        />
                    </div>
                    <div className={styles.inputGroup}>
                        <label>答案（将被加密存储）</label>
                        <input
                            type="text"
                            value={newAnswer}
                            onChange={(e) => setNewAnswer(e.target.value)}
                            placeholder="输入答案..."
                            disabled={adding}
                        />
                        <small>答案不区分大小写</small>
                    </div>
                    <div className={styles.inputGroup}>
                        <label>提示（可选）</label>
                        <input
                            type="text"
                            value={newHint}
                            onChange={(e) => setNewHint(e.target.value)}
                            placeholder="给爱人的小提示..."
                            disabled={adding}
                        />
                    </div>
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" disabled={adding} className={styles.addBtn}>
                        {adding ? '添加中...' : '添加问题'}
                    </button>
                </form>
            </section>

            <section className={styles.listSection}>
                <h2><HelpCircle size={20} /> 已有问题 ({questions.length})</h2>

                {loading ? (
                    <p className={styles.loading}>加载中...</p>
                ) : questions.length === 0 ? (
                    <p className={styles.empty}>还没有添加任何问题</p>
                ) : (
                    <div className={styles.list}>
                        <AnimatePresence>
                            {questions.map((q) => (
                                <motion.div
                                    key={q.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -50 }}
                                    className={styles.questionItem}
                                >
                                    <div className={styles.questionContent}>
                                        <p>{q.question}</p>
                                        {q.hint && <p className={styles.hintText}>提示: {q.hint}</p>}
                                        <small>添加于 {new Date(q.createdAt).toLocaleDateString('zh-CN')}</small>
                                    </div>
                                    <div className={styles.actions}>
                                        {deletingId === q.id ? (
                                            <div className={styles.confirmDelete}>
                                                <span>确定删除?</span>
                                                <button
                                                    onClick={() => confirmDelete(q.id)}
                                                    className={styles.confirmBtn}
                                                >
                                                    确定
                                                </button>
                                                <button
                                                    onClick={() => setDeletingId(null)}
                                                    className={styles.cancelBtn}
                                                >
                                                    取消
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setDeletingId(q.id)}
                                                className={styles.deleteBtn}
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
        </div>
    );
}
