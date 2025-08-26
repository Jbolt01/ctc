import type { Metadata } from 'next';
import './globals.css';
import { ReactQueryProvider } from '../providers/ReactQueryProvider';

export const metadata: Metadata = {
  title: 'Cornell Trading Competition',
  description: 'Mock trading platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900">
        <ReactQueryProvider>
          {children}
        </ReactQueryProvider>
      </body>
    </html>
  );
}

