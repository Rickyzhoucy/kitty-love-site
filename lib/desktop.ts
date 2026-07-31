'use client';

let cachedToken: string | null | undefined;

export function isTauriDesktop(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function loadDesktopToken(): Promise<string | null> {
    if (!isTauriDesktop()) return null;
    if (cachedToken !== undefined) return cachedToken;
    const { invoke } = await import('@tauri-apps/api/core');
    cachedToken = await invoke<string | null>('load_device_token');
    return cachedToken;
}

export async function saveDesktopToken(token: string): Promise<void> {
    if (!isTauriDesktop()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_device_token', { token });
    cachedToken = token;
}

export async function clearDesktopToken(): Promise<void> {
    if (!isTauriDesktop()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_device_token');
    cachedToken = null;
}

export async function desktopAuthorizationHeaders(): Promise<Record<string, string>> {
    const token = await loadDesktopToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
