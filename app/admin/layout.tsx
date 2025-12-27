import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const ADMIN_SESSION_HOURS = 24;

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // 只有非登录页需要验证
    // 注意：Layout 对所有 /admin 下的页面生效，包括 /admin 本身
    // 但我们需要在 Layout 中判断当前路径比较困难（Layout 不接收 pathname）
    // 所以我们改变策略：只在受保护的子页面检查，或者允许 /admin 访问
    // 由于 Layout 无法知道当前 route，我们这里只做基础布局
    // 权限检查移动到具体的 Page 或 Middleware (但 Middleware 有问题)

    // 替代方案：检查 Cookie 是否存在。如果存在且有效，允许访问。
    // 但 /admin 登录页本身也使用这个 Layout，所以不能在这里强制重定向到登录页
    // 除非我们能区分路径。

    // 更好的方案：保持 Layout 纯粹作为布局
    // 对于 Dashboard 等页面，在各自的 Page 组件或 Layout 中检查
    // 为了简单，我们创建一个 AuthGuard 组件或者在 Dashboard 的 Page 中检查

    // 但用户要求解决跳转循环。如果 Middleware 不检查 Dashboard，谁来检查？
    // 我们可以在 /admin/dashboard/layout.tsx 中检查！

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            overflowY: 'auto',
            background: '#F5F5F5'
        }}>
            {children}
        </div>
    );
}
