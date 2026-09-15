import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import './globals.css';

export const metadata: Metadata = {
  title: 'Accrue',
  description: 'Put your tokenized stocks to work without selling them.',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
