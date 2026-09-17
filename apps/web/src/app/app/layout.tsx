import type { JSX, ReactNode } from 'react';

import { isDevnet } from '../../server/env.js';
import { SessionProvider } from '../../client/session.js';
import { AppShell } from './AppShell.js';

export default function AppLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <SessionProvider>
      <AppShell isDevnet={isDevnet()}>{children}</AppShell>
    </SessionProvider>
  );
}
