import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const ADMIN_SESSION_HOURS = 24;

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get('admin_session');

    if (!adminCookie?.value) {
        redirect('/admin?error=no_cookie_layout');
    }

    try {
        const decoded = atob(adminCookie.value);
        const sessionData = JSON.parse(decoded);

        if (!sessionData.adminId) {
            redirect('/admin?error=no_id_layout');
        }

        const expiryTime = sessionData.timestamp + (ADMIN_SESSION_HOURS * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
            redirect('/admin?error=expired_layout');
        }

    } catch (e) {
        redirect('/admin?error=invalid_token_layout');
    }

    return (
        <>
            {children}
        </>
    );
}
