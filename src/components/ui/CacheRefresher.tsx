'use client';

import { useEffect, useRef } from 'react';
import { db } from '@/db';

const REFRESH_INTERVAL_MS = 60_000;

export function CacheRefresher({ children }: { children: React.ReactNode }) {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    db.refreshCaches();

    const interval = setInterval(() => {
      db.refreshCaches();
    }, REFRESH_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        db.refreshCaches();
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
