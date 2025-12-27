"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, HelpCircle, Lock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';

interface Question {
    id: string;
    question: string;
    createdAt: string;
}

export default function QuestionsManagement() {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(true);
    const [newQuestion, setNewQuestion] = useState('');
    const [newAnswer, setNewAnswer] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');

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
                    answer: newAnswer
                })
            });

            if (res.ok) {
                const added = await res.json();
                setQuestions([added, ...questions]);
                setNewQuestion('');
                setNewAnswer('');
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

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这个问题吗？')) return;

        try {
            const res = await fetch(`/api/admin/questions?id=${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setQuestions(questions.filter(q => q.id !== id));
            }
        } catch (err) {
            console.error('Failed to delete', err);
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
                                        <small>添加于 {new Date(q.createdAt).toLocaleDateString('zh-CN')}</small>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(q.id)}
                                        className={styles.deleteBtn}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </section>
        </div>
    );
}
