"use client";

import { useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Heart, Lock, Send, AlertCircle } from 'lucide-react';
import styles from './page.module.css';

interface Question {
    id: string;
    question: string;
    hint?: string;
}

function VerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectPath = searchParams.get('redirect') || '/';

    const [question, setQuestion] = useState<Question | null>(null);
    const [answer, setAnswer] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fetching, setFetching] = useState(false);

    // 获取随机问题
    const fetchQuestion = async () => {
        setFetching(true);
        setError('');
        try {
            const res = await fetch('/api/auth/question');
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || '获取问题失败');
                return;
            }

            setQuestion(data);
        } catch {
            setError('网络错误，请重试');
        } finally {
            setFetching(false);
        }
    };

    // 提交答案
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!question || !answer.trim()) return;

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questionId: question.id,
                    answer: answer.trim()
                })
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || '验证失败');
                // 如果是429（被锁定），不清空答案
                if (res.status !== 429) {
                    setAnswer('');
                }
                return;
            }

            // 验证成功，跳转
            router.push(redirectPath);
            router.refresh();

        } catch {
            setError('网络错误，请重试');
        } finally {
            setLoading(false);
        }
    };

    // 初始加载问题
    if (!question && !fetching && !error) {
        fetchQuestion();
    }

    return (
        <div className={styles.container}>
            <motion.div
                className={styles.card}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4 }}
            >
                <div className={styles.header}>
                    <div className={styles.iconWrapper}>
                        <Lock size={28} color="white" />
                    </div>
                    <h1>身份验证</h1>
                    <p>请回答以下问题以进入网站</p>
                </div>

                {error && (
                    <motion.div
                        className={styles.error}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <AlertCircle size={18} />
                        {error}
                    </motion.div>
                )}

                {fetching ? (
                    <div className={styles.loading}>
                        <Heart className={styles.loadingHeart} size={32} />
                        <p>正在获取问题...</p>
                    </div>
                ) : question ? (
                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.questionBox}>
                            <span className={styles.questionLabel}>问题</span>
                            <p className={styles.questionText}>{question.question}</p>
                            {question.hint && (
                                <p className={styles.hintText}>💡 提示: {question.hint}</p>
                            )}
                        </div>

                        <div className={styles.inputGroup}>
                            <input
                                type="text"
                                placeholder="请输入你的答案..."
                                value={answer}
                                onChange={(e) => setAnswer(e.target.value)}
                                className={styles.input}
                                disabled={loading}
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !answer.trim()}
                            className={styles.submitBtn}
                        >
                            {loading ? '验证中...' : (
                                <>
                                    验证 <Send size={18} />
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={fetchQuestion}
                            className={styles.refreshBtn}
                            disabled={fetching}
                        >
                            换一个问题 🔄
                        </button>
                    </form>
                ) : (
                    <div className={styles.noQuestion}>
                        <p>暂无安全问题</p>
                        <button onClick={fetchQuestion} className={styles.retryBtn}>
                            重试
                        </button>
                    </div>
                )}

                <div className={styles.footer}>
                    <Heart size={14} fill="#F48FB1" color="#F48FB1" />
                    <span>只有我们才知道的秘密</span>
                    <Heart size={14} fill="#F48FB1" color="#F48FB1" />
                </div>
            </motion.div>
        </div>
    );
}

export default function VerifyPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <VerifyContent />
        </Suspense>
    );
}
