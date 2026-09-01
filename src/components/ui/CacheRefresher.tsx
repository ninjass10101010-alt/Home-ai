'use client';

import { useEffect, useRef } from 'react';
import { db } from '@/db';
import { flushPendingWrites } from '@/lib/pending-writes';

const REFRESH_INTERVAL_MS = 60_000;

export function CacheRefresher({ children }: { children: React.ReactNode }) {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    // Replay queued meal/recipe writes first so the subsequent cache
    // refresh reads back everything the server now holds.
    flushPendingWrites().then(() => db.refreshCaches());

    const interval = setInterval(() => {
      flushPendingWrites().then(() => db.refreshCaches());
    }, REFRESH_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flushPendingWrites().then(() => db.refreshCaches());
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <>{children}</>;
}
