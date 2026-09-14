import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sea Surface Height Visualisation',
  description:
    'Dynamic visualisation of sea surface height in a WebGIS application — MSc Thesis project.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="m-0 p-0 overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
