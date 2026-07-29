export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // 权限检查在各子页面 / dashboard layout 中进行（Layout 无法感知 pathname）
    return (
        <div className="fixed inset-0 z-[var(--z-verify)] overflow-y-auto bg-sunken/50">
            {children}
        </div>
    );
}
