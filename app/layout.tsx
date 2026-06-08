import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trump OGE Filings Dashboard',
  description: 'Reuters dashboard for Trump-related OGE filing analysis.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
