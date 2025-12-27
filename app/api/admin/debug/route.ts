import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const adminSession = cookieStore.get('admin_session');

    let decoded = null;
    let error = null;

    if (adminSession?.value) {
        try {
            decoded = atob(adminSession.value);
        } catch (e: any) {
            error = e.message;
        }
    }

    return NextResponse.json({
        cookies: allCookies,
        adminSessionValue: adminSession?.value,
        decodedAdminSession: decoded,
        decodeError: error,
        timestamp: Date.now()
    });
}
