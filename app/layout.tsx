import type { Metadata } from 'next';
import { Fredoka } from 'next/font/google';
import './globals.css';
import Navbar from './components/Navbar';
import FloatingHearts from './components/FloatingHearts';

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-fredoka',
});

export const metadata: Metadata = {
  title: 'For My Love - Hello Kitty Edition',
  description: 'A special place for us.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={fredoka.className}>
        <FloatingHearts />
        <main style={{ paddingBottom: '100px', minHeight: '100vh', position: 'relative' }}>
          {children}
        </main>
        <Navbar />
      </body>
    </html>
  );
}
