import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppLayout } from '../layouts/AppLayout';
import { ThemeProvider } from '../stores/theme-store';
import '../styles/tokens.css';
import '../styles/global.css';

export const metadata: Metadata = {
  title: 'Thoon',
  description: 'Cockpit prive de trading crypto.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppLayout>{children}</AppLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
