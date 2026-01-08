"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import Countdown from './Countdown';

// Style internal to this component or reuse page.module.css if we pass className? 
// For simplicity, we'll inline some styles or duplicate relevant CSS. 
// Ideally we should import from page.module.css but Next.js CSS modules are scoped.
// I will create a simple internal style object or use inline styles for the modal.

interface EventTimer {
    id: string;
    title: string;
    date: string;
    type: 'countup' | 'countdown';
}

export default function HomeTimers() {
    const [mounted, setMounted] = useState(false);
    const [timers, setTimers] = useState<EventTimer[]>([]);
    const [showAddTimer, setShowAddTimer] = useState(false);
    const [addingTimer, setAddingTimer] = useState(false);
    const [newTimer, setNewTimer] = useState({ title: '', date: '', type: 'countup' as 'countup' | 'countdown' });

    // Ensure hydration safety - only render after mount
    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;
        fetch('/api/timers')
            .then(res => {
                if (res.status === 401) {
                    // Don't redirect if already on verify page
                    if (!window.location.pathname.startsWith('/verify')) {
                        window.location.href = '/verify?redirect=/';
                    }
                    return null;
                }
                return res.json();
            })
            .then(data => {
                if (data && Array.isArray(data)) setTimers(data);
            })
            .catch(err => console.error("Failed to fetch timers", err));
    }, [mounted]);

    const handleAddTimer = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddingTimer(true);
        try {
            const res = await fetch('/api/timers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTimer)
            });
            if (res.ok) {
                const added = await res.json();
                setTimers([...timers, added]);
                setNewTimer({ title: '', date: '', type: 'countup' });
                setShowAddTimer(false);
            } else {
                alert('添加失败');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setAddingTimer(false);
        }
    };

    // Return null on server and first client render to prevent hydration mismatch
    if (!mounted) return null;

    return (
        <>
            {/* Timers List - Top Left */}
            <div style={{ position: 'fixed', top: '20px', left: '20px', zIndex: 10 }}>
                <AnimatePresence>
                    {timers.map((t, idx) => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, x: -50 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.3 + idx * 0.15 }}
                            style={{ marginBottom: '10px' }}
                        >
                            <Countdown startDate={t.date} title={t.title} type={t.type} />
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Add Timer Button */}
                <motion.button
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 }}
                    onClick={() => setShowAddTimer(true)}
                    style={{
                        background: 'rgba(255, 255, 255, 0.8)',
                        border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        backdropFilter: 'blur(4px)'
                    }}
                    title="添加新计时器"
                >
                    <Plus size={18} color="#FF69B4" />
                </motion.button>
            </div>

            {/* Add Timer Modal */}
            <AnimatePresence>
                {showAddTimer && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setShowAddTimer(false)}
                        style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.5)', zIndex: 2000,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                    >
                        <motion.div
                            style={{
                                background: 'white', padding: '25px', borderRadius: '20px',
                                width: '90%', maxWidth: '350px', position: 'relative',
                                boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
                            }}
                            initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 style={{ margin: '0 0 20px', textAlign: 'center', color: '#333' }}>✨ 添加新纪念日</h3>
                            <form onSubmit={handleAddTimer}>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#666' }}>标题</label>
                                    <input
                                        required
                                        type="text"
                                        value={newTimer.title}
                                        onChange={e => setNewTimer({ ...newTimer, title: e.target.value })}
                                        placeholder="例如：第一次看电影"
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', outline: 'none' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#666' }}>日期</label>
                                    <input
                                        required
                                        type="datetime-local"
                                        value={newTimer.date}
                                        onChange={e => setNewTimer({ ...newTimer, date: e.target.value })}
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', outline: 'none' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '20px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#666' }}>类型</label>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setNewTimer({ ...newTimer, type: 'countup' })}
                                            style={{
                                                flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ddd',
                                                background: newTimer.type === 'countup' ? '#E0F2F1' : 'white',
                                                color: newTimer.type === 'countup' ? '#00695C' : '#666'
                                            }}
                                        >
                                            正计时
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNewTimer({ ...newTimer, type: 'countdown' })}
                                            style={{
                                                flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ddd',
                                                background: newTimer.type === 'countdown' ? '#FFEBEE' : 'white',
                                                color: newTimer.type === 'countdown' ? '#C62828' : '#666'
                                            }}
                                        >
                                            倒计时
                                        </button>
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    disabled={addingTimer}
                                    style={{
                                        width: '100%', padding: '12px', borderRadius: '12px', border: 'none',
                                        background: 'linear-gradient(135deg, #FF69B4, #fb7185)', color: 'white', fontWeight: 'bold',
                                        cursor: 'pointer', opacity: addingTimer ? 0.7 : 1
                                    }}
                                >
                                    {addingTimer ? '添加中...' : '确认添加'}
                                </button>
                            </form>
                            <button
                                onClick={() => setShowAddTimer(false)}
                                style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#999' }}
                            >
                                <X size={20} />
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
