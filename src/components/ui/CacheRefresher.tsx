'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { db } from '@/db';
import { flushPendingWrites } from '@/lib/pending-writes';
import { requestTaskOutboxFlush } from '@/lib/task-operation-outbox';

const REFRESH_INTERVAL_MS = 60_000;

export function CacheRefresher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mounted = useRef(false);

  useEffect(() => {
    // The ambient wall display (/screensaver) is a signed-out read-only board
    // that polls its own exempt endpoint — gateway polling there is 401 spam.
    if (pathname.startsWith('/screensaver')) return;

    // Durable task/config operations first, so the cache refresh that follows
    // reads back everything the server now holds. The outbox module owns the
    // single in-flight flush — this only requests one and never reads a ref at
    // render time.
    const refresh = () => {
      void requestTaskOutboxFlush()
        .then(() => flushPendingWrites())
        .then(() => db.refreshCaches());
    };

    if (!mounted.current) {
      mounted.current = true;
      // Replay queued meal/recipe writes first so the subsequent cache
      // refresh reads back everything the server now holds.
      refresh();
    }

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname]);

  return <>{children}</>;
}
