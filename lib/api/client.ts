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
        const isAdmin = pathname.startsWith('/admin');
        /**
         * **桌面宠物窗口绝不能跳走。**
         *
         * 那是一个 220px、无边框、置顶的透明窗。一旦它跳到 `/verify`，桌面上
         * 就多出一块不透明的登录页方块：输入框在可视区域外填不了，没有标题栏
         * 关不掉，也没有拖动区拖不动——「浮窗不透明、拖也拖不动」就是这么来的。
         *
         * 中间件那边已经放行了这个路由，但光放行不够：宠物一挂载就会去请求
         * `/api/v1/pet`，未登录时那个 401 会从**这里**把整个窗口带走。
         *
         * 未登录该做的是让窗口自己藏起来、把主界面推到前面（见
         * DesktopPetBridge），而不是把登录页塞进一个填不了的小方框。
         */
        const isPetWindow = pathname.startsWith('/desktop-pet');
        const isLoginPage = pathname.startsWith('/verify') || pathname.replace(/\/$/, '') === '/admin';
        if (!isLoginPage && !isPetWindow) {
            // 后台和主站是两套账号，掉线了要各回各的登录页。
            // 后台 401 跳 /verify 的话，人登进主站也还是进不去后台，
            // 只会以为「密码不对」。
            window.location.assign(
                isAdmin ? '/admin' : `/verify?redirect=${encodeURIComponent(pathname)}`,
            );
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
