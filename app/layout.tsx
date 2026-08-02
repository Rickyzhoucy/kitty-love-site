import type { Metadata } from 'next';
import { Nunito, Noto_Serif_SC } from 'next/font/google';
import './globals.css';
import BottomNav from './components/BottomNav';
import FloatingPetWrapper from './components/FloatingPetWrapper';
import { ToastProvider } from './components/ui/Toast';
import DesktopCompanionMode from './components/DesktopCompanionMode';
import DesktopPetBridge from './components/DesktopPetBridge';
import ChatMediationProvider from './components/ChatMediationProvider';

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
});

const notoSerif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-noto-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '我们的小世界',
  description: '专属于我们的数字家园',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`${nunito.variable} ${notoSerif.variable}`}>
      <head>
        {/* 首屏前恢复暗色模式，避免 FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>
        <ToastProvider>
          <DesktopCompanionMode />
          <DesktopPetBridge />
          <ChatMediationProvider>
            <main className="relative min-h-dvh pb-24">{children}</main>
            <BottomNav />
            <FloatingPetWrapper />
          </ChatMediationProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
