import type { Metadata } from 'next';
import './globals.css';
import Navbar from './components/Navbar';
import FloatingHearts from './components/FloatingHearts';
import FloatingPet from './components/FloatingPet/FloatingPet';

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
      <head>
        {/* Live2D Cubism 4 Core SDK (本地) */}
        <script src="/live2dcubismcore.min.js" defer />
        {/* PixiJS v7 & Live2D Display (本地) */}
        <script src="/pixi.min.js" defer />
        <script src="/pixi-live2d-display.min.js" defer />
      </head>
      <body>
        <FloatingHearts />
        <main style={{ paddingBottom: '100px', minHeight: '100vh', position: 'relative' }}>
          {children}
        </main>
        <Navbar />
        <FloatingPet />
      </body>
    </html>
  );
}

