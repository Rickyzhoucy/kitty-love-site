export default function VerifyLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            background: 'linear-gradient(135deg, #FCE4EC 0%, #F8BBD0 50%, #E1BEE7 100%)'
        }}>
            {children}
        </div>
    );
}
