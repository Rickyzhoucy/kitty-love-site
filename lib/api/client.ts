/**
 * 浏览器与桌面客户端共用的 HTTP 客户端。
 *
 * `NEXT_PUBLIC_API_BASE_URL` 只配置服务源地址（如 http://localhost:8000），
 * 客户端统一补充 `/api/v1`。若配置值已经包含 `/api/v1`，不会重复拼接。
 */

const API_PREFIX = '/api/v1';
const configuredBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface RequestOptions {
    body?: unknown;
    headers?: HeadersInit;
    signal?: AbortSignal;
}

function normalizePath(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return normalized.startsWith(API_PREFIX)
        ? normalized
        : `${API_PREFIX}${normalized}`;
}

/** 将相对资源路径转换为完整 API 地址，SSE 和资源下载也使用同一规则。 */
export function apiUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;

    const normalized = normalizePath(path);
    if (!configuredBaseUrl) return normalized;
    if (configuredBaseUrl.endsWith(API_PREFIX)) {
        return `${configuredBaseUrl}${normalized.slice(API_PREFIX.length)}`;
    }
    return `${configuredBaseUrl}${normalized}`;
}

function errorMessage(status: number, data: unknown): string {
    if (data && typeof data === 'object') {
        const payload = data as Record<string, unknown>;
        const value = payload.detail ?? payload.error ?? payload.message;

        if (typeof value === 'string' && value) return value;
        if (Array.isArray(value)) {
            const validationMessage = value
                .map(item => {
                    if (!item || typeof item !== 'object') return String(item);
                    const detail = item as Record<string, unknown>;
                    return typeof detail.msg === 'string' ? detail.msg : null;
                })
                .filter(Boolean)
                .join('；');
            if (validationMessage) return validationMessage;
        }
    }
    return `请求失败（${status}）`;
}

function shouldEncodeJson(body: unknown): boolean {
    return body !== undefined
        && body !== null
        && !(body instanceof FormData)
        && !(body instanceof Blob)
        && !(body instanceof URLSearchParams)
        && typeof body !== 'string';
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers: customHeaders, signal } = options;
    const headers = new Headers(customHeaders);
    const desktopHeaders = await desktopAuthorizationHeaders();
    for (const [key, value] of Object.entries(desktopHeaders)) {
        if (!headers.has(key)) headers.set(key, value);
    }
    const encodeJson = shouldEncodeJson(body);
    if (encodeJson && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
        response = await fetch(apiUrl(path), {
            method,
            headers,
            body: body === undefined
                ? undefined
                : encodeJson
                    ? JSON.stringify(body)
                    : body as BodyInit,
            credentials: 'include',
            signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, '网络连接失败，请检查服务是否可用', error);
    }

    if (response.status === 401 && typeof window !== 'undefined') {
        const pathname = window.location.pathname;
        const isLoginPage = pathname.startsWith('/verify') || pathname === '/admin' || pathname === '/admin/';
        if (!isLoginPage) {
            window.location.assign(`/verify?redirect=${encodeURIComponent(pathname)}`);
        }
    }

    const contentType = response.headers.get('content-type') ?? '';
    const data = response.status === 204
        ? null
        : contentType.includes('application/json')
            ? await response.json().catch(() => null)
            : await response.text().catch(() => null);

    if (!response.ok) {
        throw new ApiError(response.status, errorMessage(response.status, data), data);
    }

    return data as T;
}

export const api = {
    get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('GET', path, options),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('POST', path, { ...options, body }),
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('PUT', path, { ...options, body }),
    patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('PATCH', path, { ...options, body }),
    delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('DELETE', path, options),
};
import { desktopAuthorizationHeaders } from '@/lib/desktop';
