"use client";

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Calendar, FileText, History, Save, Settings } from 'lucide-react';
import Link from 'next/link';
import { getPet, updatePet } from '@/lib/api/pet';
import {
    configApi,
    type SiteConfigHistory,
} from '@/lib/api/resources';
import { PET_ASSETS, type PetAssetId } from '@/app/components/FloatingPet/petConfig';
import styles from '../questions/page.module.css';

interface ConfigState {
    letter_title: string;
    letter_content: string;
    main_timer_date: string;
}

const DEFAULT_CONFIG: ConfigState = {
    letter_title: '致我最爱的人',
    letter_content: '亲爱的…',
    main_timer_date: '2025-11-30',
};

function ConfigCard({
    title,
    children,
    saving,
    onSave,
    onReset,
}: {
    title: string;
    children: ReactNode;
    saving: boolean;
    onSave: () => void;
    onReset: () => void;
}) {
    return (
        <section className="ui-card" style={{ padding: 20, marginBottom: 20 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                <h3 style={{ margin: 0, color: 'var(--color-ink)' }}>{title}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="ui-button ui-button--ghost" onClick={onReset}>恢复默认</button>
                    <button className="ui-button" disabled={saving} onClick={onSave}>
                        <Save size={15} /> {saving ? '保存中…' : '保存'}
                    </button>
                </div>
            </header>
            {children}
        </section>
    );
}

function PetConfigCard() {
    const [assetId, setAssetId] = useState<PetAssetId>('kitty');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getPet().then(pet => setAssetId(pet.assetId ?? 'kitty')).catch(() => undefined);
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await updatePet({ assetId });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="ui-card" style={{ padding: 20, marginBottom: 20 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>桌面伙伴外观</h3>
                <button className="ui-button" disabled={saving} onClick={save}>
                    <Save size={15} /> {saving ? '保存中…' : '保存'}
                </button>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                {PET_ASSETS.map(asset => (
                    <label key={asset.id} className="ui-field" style={{ cursor: 'pointer', padding: 12 }}>
                        <span>
                            <input
                                type="radio"
                                name="petAsset"
                                checked={assetId === asset.id}
                                onChange={() => setAssetId(asset.id)}
                            />{' '}
                            {asset.emoji} {asset.name}
                        </span>
                    </label>
                ))}
            </div>
        </section>
    );
}

export default function SiteConfigPage() {
    const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
    const [history, setHistory] = useState<SiteConfigHistory[]>([]);
    const [tab, setTab] = useState<'settings' | 'history'>('settings');
    const [saving, setSaving] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const refresh = useCallback(async () => {
        const [values, entries] = await Promise.all([configApi.get(), configApi.history()]);
        setConfig({
            letter_title: values.letter_title || DEFAULT_CONFIG.letter_title,
            letter_content: values.letter_content || DEFAULT_CONFIG.letter_content,
            main_timer_date: values.main_timer_date || DEFAULT_CONFIG.main_timer_date,
        });
        setHistory(entries);
    }, []);

    useEffect(() => {
        refresh().catch(error => setMessage(error instanceof Error ? error.message : '加载失败'));
    }, [refresh]);

    const save = async (key: keyof ConfigState | 'letter') => {
        setSaving(key);
        setMessage('');
        try {
            const values = key === 'letter'
                ? { letter_title: config.letter_title, letter_content: config.letter_content }
                : { [key]: config[key] };
            await configApi.update(values);
            await refresh();
            setMessage('保存成功');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : '保存失败');
        } finally {
            setSaving(null);
        }
    };

    const reset = async (keys: (keyof ConfigState)[]) => {
        await configApi.reset(keys);
        await refresh();
        setMessage('已恢复默认');
    };

    const rollback = async (id: string) => {
        await configApi.rollback(id);
        await refresh();
        setMessage('已回滚');
    };

    return (
        <main className={styles.container}>
            <div className={styles.header}>
                <Link href="/admin/dashboard" className={styles.backBtn}><ArrowLeft size={20} /></Link>
                <h1><Settings size={24} /> 站点设置</h1>
            </div>

            {message && <p role="status" className="ui-card" style={{ padding: 12 }}>{message}</p>}

            <nav style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <button className="ui-button" onClick={() => setTab('settings')}>
                    <Settings size={16} /> 设置
                </button>
                <button className="ui-button ui-button--ghost" onClick={() => setTab('history')}>
                    <History size={16} /> 修改历史
                </button>
            </nav>

            {tab === 'settings' ? (
                <>
                    <ConfigCard
                        title="纪念日"
                        saving={saving === 'main_timer_date'}
                        onSave={() => save('main_timer_date')}
                        onReset={() => reset(['main_timer_date'])}
                    >
                        <label className="ui-field">
                            <span><Calendar size={15} /> 日期</span>
                            <input
                                type="date"
                                value={config.main_timer_date}
                                onChange={event => setConfig({ ...config, main_timer_date: event.target.value })}
                            />
                        </label>
                    </ConfigCard>

                    <ConfigCard
                        title="首页情书"
                        saving={saving === 'letter'}
                        onSave={() => save('letter')}
                        onReset={() => reset(['letter_title', 'letter_content'])}
                    >
                        <label className="ui-field">
                            <span><FileText size={15} /> 标题</span>
                            <input
                                value={config.letter_title}
                                onChange={event => setConfig({ ...config, letter_title: event.target.value })}
                            />
                        </label>
                        <label className="ui-field" style={{ marginTop: 12 }}>
                            <span>内容</span>
                            <textarea
                                rows={8}
                                value={config.letter_content}
                                onChange={event => setConfig({ ...config, letter_content: event.target.value })}
                            />
                        </label>
                    </ConfigCard>

                    <PetConfigCard />
                </>
            ) : (
                <section className="ui-card" style={{ padding: 20 }}>
                    {history.length === 0 ? <p>暂无修改记录</p> : history.map(entry => (
                        <div key={entry.id} style={{ borderBottom: '1px solid var(--color-sunken)', padding: '12px 0' }}>
                            <strong>{entry.key}</strong>
                            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.value}</p>
                            <small>{new Date(entry.createdAt).toLocaleString()}</small>{' '}
                            <button className="ui-button ui-button--ghost" onClick={() => rollback(entry.id)}>回滚</button>
                        </div>
                    ))}
                </section>
            )}
        </main>
    );
}
