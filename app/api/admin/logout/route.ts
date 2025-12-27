import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    try {
        const cookieStore = await cookies();
        cookieStore.delete('admin_session');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Admin logout failed:', error);
        return NextResponse.json(
            { error: '登出失败' },
            { status: 500 }
        );
    }
}
