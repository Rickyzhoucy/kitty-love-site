import { NextRequest } from 'next/server';

const ADMIN_SESSION_HOURS = 24;

export function verifyAdminSession(cookies: any): { valid: boolean; expired: boolean; reason?: string } {
    const adminCookie = cookies.get('admin_session');

    if (!adminCookie?.value) {
        return { valid: false, expired: false, reason: 'no_cookie' };
    }

    try {
        // Use atob for compatibility
        const decoded = atob(adminCookie.value);
        const sessionData = JSON.parse(decoded);

        if (!sessionData.adminId) {
            return { valid: false, expired: false, reason: 'no_admin_id' };
        }

        const expiryTime = sessionData.timestamp + (ADMIN_SESSION_HOURS * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
            return { valid: false, expired: true, reason: 'expired' };
        }

        return { valid: true, expired: false };
    } catch (e: any) {
        return { valid: false, expired: false, reason: `error:${e.message}` };
    }
}
