'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import Card from '../../../components/ui/Card';
import {
    adminApi,
    type McpServerRow,
    type McpToolRow,
} from '@/lib/api/admin';
import { cn } from '@/lib/utils';

/**
 * 服务器能力控制面。MCP 连接、凭据、Schema 同步和调用都只在服务器；
 * 普通用户不能安装或放行可执行能力。
 */
export default function CapabilitiesPage() {
    const [servers, setServers] = useState<McpServerRow[]>([]);
    const [tools, setTools] = useState<Record<string, McpToolRow[]>>({});
    const [expanded, setExpanded] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [headersText, setHeadersText] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setServers(await adminApi.mcpServers());
    }, []);

    useEffect(() => {
        let cancelled = false;
        adminApi.mcpServers()
            .then(rows => { if (!cancelled) setServers(rows); })
            .catch(cause => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : 'MCP 目录读取失败');
                }
            });
        return () => { cancelled = true; };
    }, []);

    const parseHeaders = (): Record<string, string> => {
        if (!headersText.trim()) return {};
        const value: unknown = JSON.parse(headersText);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('认证头必须是 JSON 对象');
        }
        const rows = Object.entries(value);
        if (!rows.every(([key, item]) => key && typeof item === 'string')) {
            throw new Error('认证头的键和值都必须是字符串');
        }
        return Object.fromEntries(rows) as Record<string, string>;
    };

    const create = async () => {
        setBusy('create');
        setError('');
        try {
            await adminApi.createMcpServer(name.trim(), url.trim(), parseHeaders());
            setName('');
            setUrl('');
            setHeadersText('');
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'MCP Server 创建失败');
        } finally {
            setBusy(null);
        }
    };

    const sync = async (server: McpServerRow) => {
        setBusy(`sync:${server.id}`);
        setError('');
        try {
            const result = await adminApi.syncMcpServer(server.id);
            setTools(current => ({ ...current, [server.id]: result.tools }));
            setExpanded(server.id);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'MCP Schema 同步失败');
            await load().catch(() => undefined);
        } finally {
            setBusy(null);
        }
    };

    const showTools = async (server: McpServerRow) => {
        if (expanded === server.id) {
            setExpanded(null);
            return;
        }
        setBusy(`tools:${server.id}`);
        setError('');
        try {
            const rows = await adminApi.mcpTools(server.id);
            setTools(current => ({ ...current, [server.id]: rows }));
            setExpanded(server.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '工具列表读取失败');
        } finally {
            setBusy(null);
        }
    };

    const toggleServer = async (server: McpServerRow) => {
        setBusy(`server:${server.id}`);
        setError('');
        try {
            await adminApi.updateMcpServer(server.id, { enabled: !server.enabled });
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'MCP Server 状态更新失败');
        } finally {
            setBusy(null);
        }
    };

    const updateTool = async (
        serverId: string,
        tool: McpToolRow,
        values: { enabled?: boolean; risk_level?: McpToolRow['riskLevel'] },
    ) => {
        setBusy(`tool:${tool.id}`);
        setError('');
        try {
            await adminApi.updateMcpTool(tool.id, values);
            const rows = await adminApi.mcpTools(serverId);
            setTools(current => ({ ...current, [serverId]: rows }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'MCP 工具审核状态更新失败');
        } finally {
            setBusy(null);
        }
    };

    const remove = async (server: McpServerRow) => {
        if (!window.confirm(`确定删除 ${server.name} 及它的工具目录吗？`)) return;
        setBusy(`delete:${server.id}`);
        setError('');
        try {
            await adminApi.deleteMcpServer(server.id);
            setExpanded(null);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'MCP Server 删除失败');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="m-0 font-display text-2xl text-ink">MCP 能力平台</h1>
                <p className="m-0 mt-1 text-xs leading-5 text-ink-muted">
                    管理员接入服务器侧 Streamable HTTP MCP；先同步 Schema，再逐项审核放行。
                    凭据只写入服务器密文，不会下发到浏览器或桌面端。
                    高风险工具在逐次用户授权与外部写回执实现前只登记，不允许启用。
                </p>
            </div>

            <Card className="p-5">
                <h2 className="m-0 font-display text-lg text-ink">新增 MCP Server</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="text-xs text-ink-muted">
                        唯一名称
                        <input
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder="calendar-tools"
                            className="mt-1 w-full rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                        />
                    </label>
                    <label className="text-xs text-ink-muted">
                        Streamable HTTP URL
                        <input
                            value={url}
                            onChange={event => setUrl(event.target.value)}
                            placeholder="https://mcp.example.com/mcp"
                            className="mt-1 w-full rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                        />
                    </label>
                    <label className="text-xs text-ink-muted md:col-span-2">
                        认证头 JSON（可选）
                        <textarea
                            value={headersText}
                            onChange={event => setHeadersText(event.target.value)}
                            rows={3}
                            placeholder={'{"Authorization":"Bearer …"}'}
                            className="mt-1 w-full resize-y rounded-xl border border-ink/10 bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent"
                        />
                    </label>
                </div>
                <button
                    type="button"
                    disabled={!name.trim() || !url.trim() || busy === 'create'}
                    onClick={create}
                    className="mt-3 rounded-xl bg-ink px-4 py-2 text-xs text-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {busy === 'create' ? '密文保存中…' : '保存为未验证'}
                </button>
            </Card>

            {error && (
                <p className="m-0 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
            )}

            <Card className="p-5">
                <h2 className="m-0 mb-3 font-display text-lg text-ink">服务器目录</h2>
                {servers.length === 0 ? (
                    <p className="m-0 text-sm text-ink-muted">还没有 MCP Server。</p>
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {servers.map(server => (
                            <li key={server.id} className="rounded-2xl border border-ink/5 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="m-0 truncate text-sm text-ink">{server.name}</p>
                                        <p className="m-0 truncate text-xs text-ink-muted">
                                            {server.url} · {server.toolCount} 个工具 · {server.status}
                                            {server.hasAuth ? ' · 已配置密文认证' : ''}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={busy === `sync:${server.id}`}
                                        onClick={() => sync(server)}
                                        className="inline-flex items-center gap-1 rounded-full bg-sunken px-3 py-1 text-xs text-ink-muted disabled:opacity-40"
                                    >
                                        <RefreshCw size={12} />
                                        {busy === `sync:${server.id}` ? '同步中…' : '同步 Schema'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => showTools(server)}
                                        className="rounded-full bg-sunken px-3 py-1 text-xs text-ink-muted"
                                    >
                                        {expanded === server.id ? '收起工具' : '审核工具'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={server.status !== 'healthy' || busy === `server:${server.id}`}
                                        onClick={() => toggleServer(server)}
                                        className={cn(
                                            'rounded-full px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40',
                                            server.enabled
                                                ? 'bg-success/15 text-success'
                                                : 'bg-sunken text-ink-muted',
                                        )}
                                    >
                                        {server.enabled ? '已接入 Agent' : '未接入 Agent'}
                                    </button>
                                    <button
                                        type="button"
                                        title="删除 MCP Server"
                                        onClick={() => remove(server)}
                                        className="rounded-full p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                {server.lastError && (
                                    <p className="mb-0 mt-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
                                        {server.lastError}
                                    </p>
                                )}
                                {expanded === server.id && (
                                    <div className="mt-3 flex flex-col gap-2">
                                        {(tools[server.id] ?? []).length === 0 ? (
                                            <p className="m-0 text-xs text-ink-muted">
                                                没有已同步工具，请先点“同步 Schema”。
                                            </p>
                                        ) : (tools[server.id] ?? []).map(tool => (
                                            <div
                                                key={tool.id}
                                                className="flex flex-wrap items-center gap-2 rounded-xl bg-sunken/60 p-2"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <p className="m-0 text-xs text-ink">{tool.name}</p>
                                                    <p className="m-0 truncate text-[11px] text-ink-muted">
                                                        {tool.description || '（没有说明）'}
                                                    </p>
                                                </div>
                                                <select
                                                    aria-label={`${tool.name} 风险级别`}
                                                    value={tool.riskLevel}
                                                    disabled={busy === `tool:${tool.id}`}
                                                    onChange={event => updateTool(server.id, tool, {
                                                        risk_level: event.target.value as McpToolRow['riskLevel'],
                                                    })}
                                                    className="rounded-full border-0 bg-surface px-2 py-1 text-xs text-ink"
                                                >
                                                    <option value="none">无副作用</option>
                                                    <option value="low">低风险</option>
                                                    <option value="high">高风险</option>
                                                </select>
                                                <button
                                                    type="button"
                                                    disabled={busy === `tool:${tool.id}`}
                                                    onClick={() => updateTool(server.id, tool, {
                                                        enabled: !tool.enabled,
                                                    })}
                                                    className={cn(
                                                        'rounded-full px-3 py-1 text-xs disabled:opacity-40',
                                                        tool.enabled
                                                            ? 'bg-success/15 text-success'
                                                            : 'bg-surface text-ink-muted',
                                                    )}
                                                >
                                                    {tool.enabled ? '已放行' : '未放行'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
