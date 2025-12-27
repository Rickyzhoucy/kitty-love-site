import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    try {
        const cookieStore = await cookies();

        // 删除认证 Cookie
        cookieStore.delete('auth_session');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Logout failed:', error);
        return NextResponse.json(
            { error: '登出失败' },
            { status: 500 }
        );
    }
}
