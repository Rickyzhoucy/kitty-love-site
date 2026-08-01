/**
 * Passkey 的浏览器侧。主站和后台共用，只是接口前缀不同。
 *
 * ## 为什么密码按钮还在
 *
 * passkey 存在设备的安全芯片里，服务端只有公钥。**手机丢了、系统重装、换到
 * 一台没同步的设备上，就再也进不来了**——没有任何找回的余地。所以密码登录
 * 保留，这里做的是加法。
 *
 * ## 不是所有设备都支持
 *
 * `isAvailable()` 会真的问一句浏览器，而不是靠 UA 猜。不支持时**整个按钮都
 * 不显示**——摆一个按下去必然失败的按钮比没有更糟。
 */

import {
    browserSupportsWebAuthn,
    platformAuthenticatorIsAvailable,
    startAuthentication,
    startRegistration,
} from '@simplewebauthn/browser';
import { api } from './api/client';

/** 这台设备现在能不能用 passkey。 */
export async function isAvailable(): Promise<boolean> {
    if (!browserSupportsWebAuthn()) return false;
    // 平台认证器 = Face ID / 指纹 / Windows Hello。没有的话虽然还能插硬件
    // 密钥，但那不是我们要给的「一键」体验，不如不显示。
    return platformAuthenticatorIsAvailable().catch(() => false);
}

/** 猜一个设备名，让人在钥匙列表里认得出是哪台。用户之后可以改。 */
export function guessDeviceLabel(): string {
    if (typeof navigator === 'undefined') return '未知设备';
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Android/.test(ua)) return 'Android 手机';
    if (/Windows/.test(ua)) return 'Windows 电脑';
    return '这台设备';
}

interface BeginPayload {
    challengeId: string;
    /** 服务端把 options 序列化成 JSON 字符串发过来。 */
    options: string;
}

/**
 * 给当前账号加一把钥匙。调用方必须已经登录。
 *
 * `base` 是 `/auth/passkey`（主站）或 `/admin/auth/passkey`（后台）。
 */
export async function registerPasskey(base: string, label?: string) {
    const begin = await api.post<BeginPayload>(`${base}/register/begin`);
    const credential = await startRegistration({
        optionsJSON: JSON.parse(begin.options),
    });
    return api.post<{ id: string; label: string }>(`${base}/register/finish`, {
        challenge_id: begin.challengeId,
        credential,
        label: label ?? guessDeviceLabel(),
    });
}

/**
 * 用钥匙登录。
 *
 * 服务端不带 `allow_credentials`，走可发现凭据——**登录前我们并不知道来的是
 * 谁**，用户点一下就能在设备的账号选择器里选。这正是「一键」的来源。
 */
export async function loginWithPasskey<T>(base: string): Promise<T> {
    const begin = await api.post<BeginPayload>(`${base}/login/begin`);
    const credential = await startAuthentication({
        optionsJSON: JSON.parse(begin.options),
    });
    return api.post<T>(`${base}/login/finish`, {
        challenge_id: begin.challengeId,
        credential,
    });
}

export interface PasskeyRow {
    id: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
}

export const listPasskeys = (base: string) => api.get<PasskeyRow[]>(base);
export const deletePasskey = (base: string, id: string) =>
    api.delete<void>(`${base}/${id}`);

/**
 * 把 WebAuthn 抛出的异常翻译成人话。
 *
 * 浏览器在「用户点了取消」和「域名配错了」两种情况下抛的都是
 * `NotAllowedError`，原始文案对用户毫无帮助。
 */
export function explain(error: unknown): string {
    if (!(error instanceof Error)) return '出了点问题，再试一次';
    if (error.name === 'NotAllowedError') return '取消了，或者这台设备拒绝了';
    if (error.name === 'InvalidStateError') return '这台设备已经登记过了';
    if (error.name === 'SecurityError') {
        // 这条几乎总是 RP ID 和域名对不上。见 backend/app/passkeys.py。
        return '域名配置不对，登不了——去后台「系统配置」检查 Passkey 域名';
    }
    return error.message || '出了点问题，再试一次';
}
