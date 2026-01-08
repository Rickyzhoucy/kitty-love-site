import type { Metadata } from 'next';
import './globals.css';
import Navbar from './components/Navbar';
import FloatingHearts from './components/FloatingHearts';
import FloatingPetWrapper from './components/FloatingPetWrapper';

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
        {/* Live2D scripts are now loaded dynamically in FloatingPet when needed */}
      </head>
      <body>
        <FloatingHearts />
        <main style={{ paddingBottom: '100px', minHeight: '100vh', position: 'relative' }}>
          {children}
        </main>
        <Navbar />
        <FloatingPetWrapper />
      </body>
    </html>
  );
}

