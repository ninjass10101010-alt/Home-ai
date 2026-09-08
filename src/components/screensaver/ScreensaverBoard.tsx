'use client';

/**
 * Ambient wall-display board (spec 2026-09-07). Read-only: no auth, no nav,
 * no writes. Clock ticks locally; data re-polls the exempt endpoint every 60s
 * and on tab-visible. Failures keep last-good data; a quiet stale dot appears
 * after 5 min without a successful fetch.
 */
import { useEffect, useState } from 'react';
import type { ScreensaverPayload } from '@/lib/screensaver/compose';

const POLL_MS = 60_000;
const STALE_MS = 5 * 60_000;

export function ScreensaverBoard({ initial }: { initial: ScreensaverPayload | null }) {
  const [data, setData] = useState<ScreensaverPayload | null>(initial);
  const [lastOk, setLastOk] = useState<number>(() => (initial ? Date.now() : 0));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const res = await fetch('/api/consuela/screensaver', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as ScreensaverPayload;
        if (dead || json?.ok !== true) return;
        setData(json);
        setLastOk(Date.now());
      } catch {
        /* keep last-good data — the stale dot reports it */
      }
    };
    const id = setInterval(pull, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') pull();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      dead = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const stale = lastOk > 0 && now.getTime() - lastOk > STALE_MS;
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main
      className="fixed inset-0 flex flex-col gap-[3vh] overflow-hidden bg-[#0f1117] p-[4vh] text-white"
      style={{ fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui' }}
    >
      <header className="flex items-end justify-between">
        <div data-testid="ss-clock">
          <div className="text-[14vh] font-black leading-none tracking-tight tabular-nums">{clock}</div>
          <div className="mt-[1vh] text-[4vh] font-medium text-white/70">{dateLine}</div>
        </div>
        {data?.weather && (
          <div data-testid="ss-weather" className="text-right text-[4vh] font-semibold text-white/85">
            <div className="text-[9vh] leading-none tabular-nums">{data.weather.tempF}°</div>
            <div>{data.weather.condition}</div>
            <div className="text-[3vh] text-white/60 tabular-nums">
              H {data.weather.hiF}° · L {data.weather.loF}°
            </div>
          </div>
        )}
        {stale && (
          <span
            data-testid="ss-stale"
            aria-label="Data may be out of date"
            className="absolute right-[4vh] top-[4vh] h-[1.6vh] w-[1.6vh] rounded-full bg-amber-400/80"
          />
        )}
      </header>

      <section className="grid flex-1 grid-cols-3 gap-[2.5vh]">
        <div className="flex min-h-0 flex-col rounded-[3vh] bg-white/[0.05] p-[2.5vh] ring-1 ring-white/10">
          <h2 className="mb-[1.5vh] text-[2.6vh] font-bold uppercase tracking-[0.2em] text-white/50">Today</h2>
          <ul data-testid="ss-events" className="flex flex-col gap-[1.4vh] overflow-hidden text-[3.4vh]">
            {(data?.events ?? []).length === 0 && (
              <li className="text-white/45">{data ? 'Quiet day' : 'Waiting for the family server…'}</li>
            )}
            {data?.events.map((e, i) => (
              <li key={i} className="flex items-baseline gap-[1.4vh]">
                <span
                  aria-hidden
                  className="inline-block h-[1.4vh] w-[1.4vh] shrink-0 rounded-full"
                  style={{ background: e.color ?? 'rgba(255,255,255,0.4)' }}
                />
                <span className="w-[13vh] shrink-0 tabular-nums text-white/60">{e.time}</span>
                <span className="min-w-0 truncate">{e.title}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-h-0 flex-col gap-[2.5vh] rounded-[3vh] bg-white/[0.05] p-[2.5vh] ring-1 ring-white/10">
          <div>
            <h2 className="mb-[1vh] text-[2.6vh] font-bold uppercase tracking-[0.2em] text-white/50">Tonight</h2>
            <p data-testid="ss-dinner" className="truncate text-[4vh] font-semibold">
              {data ? (data.dinner ? data.dinner.name : 'Nothing planned yet') : '…'}
            </p>
          </div>
          <div>
            <h2 className="mb-[1vh] text-[2.6vh] font-bold uppercase tracking-[0.2em] text-white/50">Chores</h2>
            <p data-testid="ss-chores" className="text-[4vh] font-semibold tabular-nums">
              {data ? `${data.tasks.done} of ${data.tasks.total} done` : '…'}
            </p>
            <div className="mt-[1vh] h-[1.2vh] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400/80"
                style={{ width: data && data.tasks.total > 0 ? `${Math.round((data.tasks.done / data.tasks.total) * 100)}%` : '0%' }}
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-[3vh] bg-white/[0.05] p-[2.5vh] ring-1 ring-white/10">
          <h2 className="mb-[1.5vh] text-[2.6vh] font-bold uppercase tracking-[0.2em] text-white/50">Consuela</h2>
          <ul data-testid="ss-briefing" className="flex flex-col gap-[1.4vh] overflow-hidden text-[3.2vh] text-white/85">
            {(data?.briefing ?? []).map((line, i) => (
              <li key={i} className="line-clamp-2">{line}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
