import type { JSX, ReactNode } from 'react';

import { isDevnet } from '../../server/env.js';
import { NoticeProvider } from '../../client/notices.js';
import { SessionProvider } from '../../client/session.js';
import { AppShell } from './AppShell.js';

export default function AppLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <SessionProvider>
      <NoticeProvider>
        <AppShell isDevnet={isDevnet()}>{children}</AppShell>
      </NoticeProvider>
    </SessionProvider>
  );
}
