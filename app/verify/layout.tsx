export default function VerifyLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        // 盖住全局导航与宠物的全屏层（语义保留，样式融入全站奶油底）
        <div className="fixed inset-0 z-[var(--z-verify)] bg-base">
            {children}
        </div>
    );
}
