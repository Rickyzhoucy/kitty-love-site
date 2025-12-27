"use client";

import { useState, useEffect } from 'react';
import { Settings, Save, Upload, ArrowLeft, RefreshCw, Calendar, FileText, Box } from 'lucide-react';
import Link from 'next/link';
import styles from '../questions/page.module.css';

interface ConfigState {
    letter_title: string;
    letter_content: string;
    main_timer_date: string;
    home_model_url: string;
}

// 1. Move Card component outside to prevent re-rendering and focus loss
const Card = ({ title, icon: Icon, children, onSave, onReset, saving }: any) => (
    <div style={{
        background: 'white', padding: '20px', borderRadius: '15px',
        marginBottom: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
        border: '1px solid #F0F0F0'
    }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#FFF3E0', padding: '8px', borderRadius: '8px' }}>
                    <Icon size={20} color="#FFB74D" />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#333' }}>{title}</h3>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={onReset}
                    style={{
                        background: 'transparent', border: '1px solid #ffccbc', color: '#ff7043',
                        padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                >
                    <RefreshCw size={14} /> 恢复默认
                </button>
                <button
                    onClick={onSave}
                    disabled={!!saving}
                    style={{
                        background: '#4DD0E1', border: 'none', color: 'white',
                        padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                >
                    {saving ? '...' : <><Save size={14} /> 保存</>}
                </button>
            </div>
        </div>
        {children}
    </div>
);

// 0. Define Defaults
const DEFAULT_CONFIG = {
    letter_title: '致我最爱的人',
    letter_content: '<p>亲爱的...</p>',
    main_timer_date: '2025-11-30',
    home_model_url: ''
};

export default function SiteConfigPage() {
    const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
    const [history, setHistory] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [modal, setModal] = useState<{
        open: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm';
        onConfirm?: () => void;
    }>({ open: false, title: '', message: '', type: 'alert' });

    useEffect(() => {
        fetchConfig();
        fetchHistory();
    }, []);

    const showModal = (title: string, message: string, type: 'alert' | 'confirm' = 'alert', onConfirm?: () => void) => {
        setModal({ open: true, title, message, type, onConfirm });
    };

    const closeModal = () => {
        setModal(prev => ({ ...prev, open: false }));
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/admin/config');
            if (res.ok) {
                const data = await res.json();
                setConfig({
                    letter_title: data.letter_title || DEFAULT_CONFIG.letter_title,
                    letter_content: data.letter_content || '',
                    main_timer_date: data.main_timer_date || '2025-11-30',
                    home_model_url: data.home_model_url || ''
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/admin/config/history');
            if (res.ok) setHistory(await res.json());
        } catch (err) {
            console.error(err);
        }
    };

    const handleSave = async (section: 'anniversary' | 'letter' | 'model') => {
        setSaving(section);
        const dataToSave: Partial<ConfigState> = {};

        if (section === 'anniversary') {
            dataToSave.main_timer_date = config.main_timer_date;
        } else if (section === 'letter') {
            dataToSave.letter_title = config.letter_title;
            dataToSave.letter_content = config.letter_content;
        } else if (section === 'model') {
            dataToSave.home_model_url = config.home_model_url;
        }

        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave)
            });
            if (res.ok) {
                showModal('成功', '保存成功', 'alert', () => fetchHistory());
            } else {
                showModal('错误', '保存失败');
            }
        } catch {
            showModal('错误', '网络错误');
        } finally {
            setSaving(null);
        }
    };

    const handleReset = async (keys: string[]) => {
        showModal('确认恢复默认', '确定要恢复默认设置吗？当前的自定义配置将被删除。', 'confirm', async () => {
            try {
                const res = await fetch(`/api/admin/config?keys=${keys.join(',')}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    showModal('成功', '已恢复默认');
                    fetchConfig();
                    fetchHistory();
                } else {
                    showModal('错误', '重置失败');
                }
            } catch {
                showModal('错误', '重置出错');
            }
        });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                setConfig(prev => ({ ...prev, home_model_url: data.url }));
                e.target.value = '';
                showModal('上传成功', '模型上传成功，请点击右上角保存按钮应用更改！');
            } else {
                showModal('错误', '上传失败');
            }
        } catch {
            showModal('错误', '上传出错');
        }
    };

    const handleRollback = async (id: string) => {
        showModal('确认回滚', '确定要回滚到这个版本吗？', 'confirm', async () => {
            try {
                const res = await fetch('/api/admin/config/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                if (res.ok) {
                    showModal('成功', '回滚成功');
                    fetchConfig();
                    fetchHistory();
                } else {
                    showModal('错误', '回滚失败');
                }
            } catch {
                showModal('错误', '回滚出错');
            }
        });
    };

    if (loading) return <div className={styles.loading}>加载中...</div>;

    return (
        <div className={styles.container}>
            {/* Modal */}
            {modal.open && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div style={{
                        background: 'white', padding: '25px', borderRadius: '15px',
                        width: '90%', maxWidth: '400px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                        animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <h3 style={{ margin: '0 0 10px', fontSize: '1.2rem', color: '#333' }}>{modal.title}</h3>
                        <p style={{ margin: '0 0 20px', color: '#666', lineHeight: '1.5' }}>{modal.message}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            {modal.type === 'confirm' && (
                                <button
                                    onClick={closeModal}
                                    style={{
                                        padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd',
                                        background: 'transparent', cursor: 'pointer', color: '#666'
                                    }}
                                >
                                    取消
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (modal.onConfirm) modal.onConfirm();
                                    closeModal();
                                }}
                                style={{
                                    padding: '8px 16px', borderRadius: '8px', border: 'none',
                                    background: '#F48FB1', cursor: 'pointer', color: 'white', fontWeight: 'bold'
                                }}
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <header className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}>
                    <ArrowLeft size={20} /> 返回
                </Link>
                <div className={styles.headerContent}>
                    <Settings size={28} color="#FFB74D" />
                    <div>
                        <h1>网站全局配置</h1>
                        <p>自定义与模块化管理</p>
                    </div>
                </div>
            </header>

            <div style={{ maxWidth: '800px', margin: '0 auto 1.5rem', display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => setActiveTab('settings')}
                    style={{
                        padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                        background: activeTab === 'settings' ? '#F48FB1' : '#E0E0E0',
                        color: activeTab === 'settings' ? 'white' : '#757575', fontWeight: 'bold'
                    }}
                >
                    配置模块
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    style={{
                        padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                        background: activeTab === 'history' ? '#F48FB1' : '#E0E0E0',
                        color: activeTab === 'history' ? 'white' : '#757575', fontWeight: 'bold'
                    }}
                >
                    修改历史
                </button>
            </div>

            {activeTab === 'settings' ? (
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>

                    {/* Anniversary Module */}
                    <Card
                        title="纪念日设置"
                        icon={Calendar}
                        saving={saving === 'anniversary'}
                        onSave={() => handleSave('anniversary')}
                        onReset={() => handleReset(['main_timer_date'])}
                    >
                        <div className={styles.inputGroup}>
                            <label>我们在一起的时间（主计时器）</label>
                            <input
                                type="date"
                                value={config.main_timer_date || ''}
                                onChange={(e) => setConfig({ ...config, main_timer_date: e.target.value })}
                            />
                            <small style={{ color: '#999' }}>默认值：2025-11-30</small>
                        </div>
                    </Card>

                    {/* Letter Module */}
                    <Card
                        title="情书设置"
                        icon={FileText}
                        saving={saving === 'letter'}
                        onSave={() => handleSave('letter')}
                        onReset={() => handleReset(['letter_title', 'letter_content'])}
                    >
                        <div className={styles.inputGroup}>
                            <label>情书标题</label>
                            <input
                                type="text"
                                value={config.letter_title || ''}
                                onChange={(e) => setConfig({ ...config, letter_title: e.target.value })}
                                placeholder="致我最爱的人"
                            />
                        </div>
                        <div className={styles.inputGroup}>
                            <label>情书内容 (支持HTML)</label>
                            <textarea
                                style={{
                                    width: '100%', minHeight: '150px', padding: '10px',
                                    border: '2px solid #E0E0E0', borderRadius: '10px', fontSize: '1rem', outline: 'none'
                                }}
                                value={config.letter_content || ''}
                                onChange={(e) => setConfig({ ...config, letter_content: e.target.value })}
                                placeholder="写下你想对TA说的话..."
                            />
                        </div>
                    </Card>

                    {/* Model Module */}
                    <Card
                        title="3D 模型设置"
                        icon={Box}
                        saving={saving === 'model'}
                        onSave={() => handleSave('model')}
                        onReset={() => handleReset(['home_model_url'])}
                    >
                        <div className={styles.inputGroup}>
                            <label>首页 3D 模型 (.glb)</label>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={config.home_model_url || ''}
                                    readOnly
                                    placeholder="默认 Hello Kitty 模型"
                                    style={{ flex: 1 }}
                                />
                                <label className={styles.uploadBtn} style={{
                                    background: '#4DD0E1', color: 'white', padding: '8px 15px',
                                    borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px'
                                }}>
                                    <Upload size={18} />
                                    上传
                                    <input type="file" accept=".glb,.gltf" hidden onChange={handleFileUpload} />
                                </label>
                            </div>
                        </div>
                    </Card>

                </div>
            ) : (
                <section className={styles.listSection} style={{ maxWidth: '800px', margin: '0 auto' }}>
                    {/* Reuse existing history list UI */}
                    {history.length === 0 ? <p className={styles.empty}>暂无修改记录</p> : (
                        <div className={styles.list}>
                            {history.map((h) => (
                                <div key={h.id} className={styles.questionItem} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <span style={{ background: '#EEEEEE', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#666' }}>
                                            {h.key}
                                        </span>
                                        <small style={{ color: '#999' }}>{new Date(h.createdAt).toLocaleString()}</small>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: '#333', background: '#FAFAFA', width: '100%', padding: '8px', borderRadius: '6px', wordBreak: 'break-all' }}>
                                        {h.value === '[RESET TO DEFAULT]' ? <span style={{ color: '#ff7043' }}>已重置为默认值</span> : (h.value.length > 100 ? h.value.substring(0, 100) + '...' : h.value)}
                                    </div>
                                    <button
                                        onClick={() => handleRollback(h.id)}
                                        style={{
                                            background: 'transparent', border: '1px solid #FFAB91', color: '#FF5722',
                                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
                                            alignSelf: 'flex-end'
                                        }}
                                    >
                                        回滚到此版本
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
