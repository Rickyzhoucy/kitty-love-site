import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    if (!cookieStore.get('kitty_session')?.value) {
        redirect('/admin');
    }

    return children;
}
