# Weather Widget Live Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Home weather card refreshes its Open-Meteo data every 15 minutes and immediately on tab wake with stale data — silently, without losing what's on screen.

**Architecture:** All changes stay inside `src/components/ui/WeatherWidget.tsx`. The existing mount-only fetch effect is extracted into a stable `loadWeather()` callback guarded by an in-flight ref; a 15-minute `setInterval` and an extended `visibilitychange` listener (stale > 10 min → refetch) hang off it. Freshness (`updatedAt`) advances only on success; background failures keep stale data silently.

**Tech Stack:** Next.js 16 + React 19, TypeScript, Vitest (jsdom, fake timers), plain `fetch`.

## Global Constraints

- **No new dependencies.** No SWR/TanStack Query. No new files for the widget logic.
- **Fixed constants:** poll interval `15 * 60_000` ms; wake-staleness threshold `10 * 60_000` ms (verbatim from spec).
- **Silent refresh:** `loading` may only be `true` before the FIRST successful fetch. Background refreshes never render the Skeleton.
- **Error rule:** background fetch failure → keep stale data, NO error banner; banner only when no data has ever loaded (initial fetch fails).
- **Do not touch the Instacart session's files** (`src/components/meals/*`, `src/lib/instacart.ts`, `src/middleware.ts`). Only `WeatherWidget.tsx`, its test file, and AGENTS.md.
- **Commit hygiene:** never `git add -A`. Stage only the exact files listed per task (`git add src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx ...`). Re-check `git status` before committing AGENTS.md — another session is active in this repo.
- **No deploy.** Code lands on `warm-glass-v2` locally; NAS deploy happens later with the Instacart session's work.
- Verification commands: `npx vitest run tests/unit/weather-widget.test.tsx` (single file), `npx vitest run` (full suite), `npm run typecheck`, `npx eslint src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx`.

---

### Task 1: Extract fetch into `loadWeather` callback + in-flight guard (behavior-neutral refactor)

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx:4` (add `useCallback` import) and `:549-636` (fetch effect) + `:655-659` (visibility effect, move only)
- Test: none new — existing suite must stay green.

**Interfaces:**
- Consumes: existing state setters (`setWeatherData`, `setLoading`, `setFetchError`, `setUpdatedAt`), `runtime` from `useRuntimeConfig()`.
- Produces: `loadWeather: () => void` — stable `useCallback` keyed on `[runtime?.weather_location?.LAT, runtime?.weather_location?.LON]`; refs `inFlightRef` / `updatedAtRef` / `dataLoadedRef` (declared here; `updatedAtRef` + `dataLoadedRef` become active in Tasks 3–4).

- [ ] **Step 1: Edit the import line**

`src/components/ui/WeatherWidget.tsx` line 4 currently:
```tsx
import { useState, useEffect, useRef, useMemo } from "react";
```
Replace with:
```tsx
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
```

- [ ] **Step 2: Replace the fetch effect + visibility effect with the extracted callback**

Replace lines 549–561 (state block through the `useRuntimeConfig` line is unchanged) — specifically, after `const { runtime } = useRuntimeConfig();` (line 555) and before the `useEffect` at 638, replace the block from line 557 (`useEffect(() => {` opening the fetch effect) through line 659 (end of the visibility effect) with:

```tsx
  const dataLoadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const updatedAtRef = useRef<number | null>(null);

  const loadWeather = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const lat = Number(runtime?.weather_location?.LAT ?? 42.7875);
    const lon = Number(runtime?.weather_location?.LON ?? -86.1089);
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day,cloud_cover,uv_index,pressure_msl,visibility&hourly=temperature_2m,weather_code,precipitation_probability,is_day,cloud_cover,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`)
      .then(r => r.json())
      .then(data => {
        const current = data.current ?? {};
        const daily = data.daily;
        const hourly = data.hourly;
        const currentWMO = wmoToCondition(current.weather_code ?? 1);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        const hours: HourPoint[] = [];
        if (hourly?.time) {
          const nowMs = Date.now();
          let start = hourly.time.findIndex((t: string) => new Date(t).getTime() >= nowMs - 59 * 60 * 1000);
          if (start === -1) start = 0;
          const fallbackIsDay = getRealTimeOfDay() === "day";
          for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
            hours.push({
              time: hourly.time[i],
              temp: hourly.temperature_2m?.[i] ?? current.temperature_2m ?? 60,
              code: hourly.weather_code?.[i] ?? current.weather_code ?? 1,
              precip: hourly.precipitation_probability?.[i] ?? 0,
              isDay: hourly.is_day?.[i] != null ? hourly.is_day[i] === 1 : fallbackIsDay,
              cloud: hourly.cloud_cover?.[i] ?? current.cloud_cover ?? 25,
              wind: hourly.wind_speed_10m?.[i] ?? current.wind_speed_10m ?? 5,
              windDir: hourly.wind_direction_10m?.[i] ?? current.wind_direction_10m ?? 270,
              humidity: hourly.relative_humidity_2m?.[i] ?? current.relative_humidity_2m ?? 50,
              visibility: typeof hourly.visibility?.[i] === "number"
                ? hourly.visibility[i]
                : (typeof current.visibility === "number" ? current.visibility : null),
            });
          }
        }

        const forecast: ForecastDay[] = daily?.time
          ? daily.time.slice(1, 6).map((date: string, i: number) => {
            const wmo = wmoToCondition(daily.weather_code?.[i + 1] ?? 1);
            return {
              day: days[new Date(date).getDay()],
              high: Math.round(daily.temperature_2m_max?.[i + 1] ?? 70),
              low: Math.round(daily.temperature_2m_min?.[i + 1] ?? 55),
              condition: wmo.condition,
              emoji: wmo.emoji,
              precipitation: daily.precipitation_probability_max?.[i + 1] || 0,
            };
          })
          : [];

        setWeatherData({
          temp: Math.round(current.temperature_2m ?? 60),
          feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 60),
          humidity: current.relative_humidity_2m ?? 50,
          wind: Math.round(current.wind_speed_10m ?? 5),
          windDir: current.wind_direction_10m ?? 270,
          code: current.weather_code ?? 1,
          isDay: current.is_day != null ? current.is_day === 1 : getRealTimeOfDay() === "day",
          cloud: current.cloud_cover ?? 25,
          uv: typeof current.uv_index === "number" ? Math.round(current.uv_index) : (typeof daily?.uv_index_max?.[0] === "number" ? Math.round(daily.uv_index_max[0]) : null),
          pressure: typeof current.pressure_msl === "number" ? Math.round(current.pressure_msl) : null,
          visibility: typeof current.visibility === "number" ? current.visibility : null,
          condition: currentWMO.condition,
          sunriseISO: daily?.sunrise?.[0] ?? null,
          sunsetISO: daily?.sunset?.[0] ?? null,
          hours,
          forecast,
          todayHigh: typeof daily?.temperature_2m_max?.[0] === "number" ? Math.round(daily.temperature_2m_max[0]) : null,
          todayLow: typeof daily?.temperature_2m_min?.[0] === "number" ? Math.round(daily.temperature_2m_min[0]) : null,
          outlook: deriveOutlook(hourly, currentWMO.condition),
        });
        setUpdatedAt(Date.now());
        setFetchError(null);
        setLoading(false);
      })
      .catch(() => {
        setFetchError("Weather unavailable — check connection or try again.");
        setLoading(false);
      })
      .finally(() => { inFlightRef.current = false; });
  }, [runtime?.weather_location?.LAT, runtime?.weather_location?.LON]);

  useEffect(() => { loadWeather(); }, [loadWeather]);
```

And the visibility effect (lines 655–659) stays exactly as it is for now:
```tsx
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
```

Note: everything inside the `.then(data => { ... })` body is copied VERBATIM from the old effect — do not alter the mapping. The only semantic additions are the `inFlightRef` guard at the top and `.finally` at the bottom. `dataLoadedRef` and `updatedAtRef` are declared now but unused until Tasks 3–4 (harmless; eslint may flag unused vars — if so, hold their declaration until the task that uses them, but do NOT skip the refactor).

- [ ] **Step 3: Verify existing tests pass**

Run: `npx vitest run tests/unit/weather-widget.test.tsx`
Expected: all existing tests PASS (no new tests yet). Run full suite: `npx vitest run` — expect 651 passed, 0 failed.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck` → clean. `npx eslint src/components/ui/WeatherWidget.tsx` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx
git commit -m "refactor(weather): extract loadWeather callback + in-flight guard"
```

---

### Task 2: 15-minute interval refetch

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx` (add the interval effect after the `useEffect(() => { loadWeather(); }, [loadWeather])` line)
- Test: `tests/unit/weather-widget.test.tsx` (add 1 test)

**Interfaces:**
- Consumes: `loadWeather` from Task 1.
- Produces: nothing new — the same `loadWeather` signature.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/weather-widget.test.tsx` inside the existing `describe("WeatherWidget — Not Boring redesign", ...)` block (after the last test, before the closing `});`):

```tsx
  it("refetches weather every 15 minutes on its own", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/weather-widget.test.tsx -t "every 15 minutes"`
Expected: FAIL — `expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)` fails (actual 1) because no interval exists.

- [ ] **Step 3: Add the interval effect**

In `src/components/ui/WeatherWidget.tsx`, immediately after `useEffect(() => { loadWeather(); }, [loadWeather]);` add:

```tsx
  useEffect(() => {
    const id = setInterval(loadWeather, 15 * 60_000);
    return () => clearInterval(id);
  }, [loadWeather]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/weather-widget.test.tsx -t "every 15 minutes"`
Expected: PASS.

- [ ] **Step 5: Run the whole weather test file + full suite**

Run: `npx vitest run tests/unit/weather-widget.test.tsx` then `npx vitest run`
Expected: weather file all green; suite 652 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx
git commit -m "feat(weather): auto-refresh every 15 minutes"
```

---

### Task 3: Tab-wake refetch when data is stale (> 10 min)

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx` (extend the visibility effect; write `updatedAtRef` in the success path)
- Test: `tests/unit/weather-widget.test.tsx` (add 2 tests)

**Interfaces:**
- Consumes: `loadWeather`, `updatedAtRef` (declared Task 1), `Date.now()`.
- Produces: visibility listener semantics — `visibilitychange` triggers `loadWeather()` only when the tab is visible AND `updatedAtRef.current !== null` AND `Date.now() - updatedAtRef.current > 10 * 60_000`.

- [ ] **Step 1: Write the failing tests**

Append inside the same `describe` block:

```tsx
  it("refetches when the tab becomes visible again with stale data", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

      // 11 minutes pass (under the 15-min poll threshold, over the 10-min stale threshold)
      await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60_000); });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch on tab wake when data is still fresh", async () => {
    vi.useFakeTimers();
    try {
      mockOpenMeteo(makeOpenMeteoPayload());
      render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

      // only 5 minutes pass
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/weather-widget.test.tsx -t "tab becomes visible"` then `-t "still fresh"`
Expected: first FAILS (actual 1 call vs expected 2 — the visibility listener doesn't refetch), second PASSES trivially (no refetch logic exists at all).

- [ ] **Step 3: Wire `updatedAtRef` into the success path**

In `loadWeather`, replace the line `setUpdatedAt(Date.now());` with:
```tsx
        const fetchedAt = Date.now();
        setUpdatedAt(fetchedAt);
        updatedAtRef.current = fetchedAt;
```

- [ ] **Step 4: Extend the visibility effect**

Replace the existing visibility effect:
```tsx
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
```
with:
```tsx
  useEffect(() => {
    const onVisibility = () => {
      setTabHidden(document.hidden);
      if (
        !document.hidden &&
        updatedAtRef.current !== null &&
        Date.now() - updatedAtRef.current > 10 * 60_000
      ) {
        loadWeather();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadWeather]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/weather-widget.test.tsx`
Expected: all weather tests PASS (including both new ones).

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `npx vitest run` (654 passed), `npm run typecheck` (clean), `npx eslint src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx
git commit -m "feat(weather): refetch on tab wake when data is stale"
```

---

### Task 4: Silent refresh + background-failure semantics

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx` (`.catch` branch: only surface error/stop loading when no data has ever loaded)
- Test: `tests/unit/weather-widget.test.tsx` (add 2 tests)

**Interfaces:**
- Consumes: `dataLoadedRef` (declared Task 1).
- Produces: error rule — `setFetchError` + `setLoading(false)` only when `dataLoadedRef.current === false`; success sets `dataLoadedRef.current = true`.

- [ ] **Step 1: Write the failing tests**

Append inside the same `describe` block:

```tsx
  it("refreshes silently — no skeleton flash and stale data stays during the in-flight refresh", async () => {
    vi.useFakeTimers();
    try {
      let resolveSecond!: (v: { json: () => Promise<unknown> }) => void;
      const second = new Promise<{ json: () => Promise<unknown> }>((r) => { resolveSecond = r; });
      let calls = 0;
      const payload = makeOpenMeteoPayload();
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return second;
        }
        return Promise.reject(new Error("no network"));
      }));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°");

      // fire the 15-min poll; second request is now in flight (unresolved)
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(el.querySelector(".animate-pulse")).toBeNull(); // no Skeleton
      expect(el.textContent).toContain("H:75°"); // stale data still shown

      const updated = makeOpenMeteoPayload();
      updated.current.temperature_2m = 81;
      await act(async () => {
        resolveSecond({ json: () => Promise.resolve(updated) });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(el.textContent).toContain("81"); // new temp landed (reduced-motion stub → instant)
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stale data and shows no error banner when a background refresh fails", async () => {
    vi.useFakeTimers();
    try {
      const payload = makeOpenMeteoPayload();
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.open-meteo.com")) {
          calls += 1;
          if (calls === 1) return Promise.resolve({ json: () => Promise.resolve(payload) });
          return Promise.reject(new Error("network down"));
        }
        return Promise.reject(new Error("no network"));
      }));

      const el = render(<WeatherWidget />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(el.textContent).toContain("H:75°");

      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(el.textContent).toContain("H:75°"); // stale data kept
      expect(el.textContent).not.toContain("Weather unavailable"); // no banner
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/weather-widget.test.tsx -t "silently"` then `-t "background refresh fails"`
Expected: first PASSES as written (Task 1's code never re-sets `loading` — the silent behavior already holds; if it passes, keep it as a regression guard). Second FAILS: the current `.catch` always sets `fetchError`, so the banner text "Weather unavailable" IS present.

- [ ] **Step 3: Gate the error path on `dataLoadedRef`**

In `loadWeather`'s success `.then`, add one line after `setFetchError(null);`:
```tsx
        dataLoadedRef.current = true;
```
Then replace the `.catch` block:
```tsx
      .catch(() => {
        setFetchError("Weather unavailable — check connection or try again.");
        setLoading(false);
      })
```
with:
```tsx
      .catch(() => {
        if (!dataLoadedRef.current) {
          setFetchError("Weather unavailable — check connection or try again.");
          setLoading(false);
        }
      })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/weather-widget.test.tsx`
Expected: all weather tests PASS.

- [ ] **Step 5: Full suite + typecheck + lint**

Run: `npx vitest run` (656 passed), `npm run typecheck` (clean), `npx eslint src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx
git commit -m "feat(weather): silent background refresh — keep stale data on failure"
```

---

### Task 5: AGENTS.md documentation + final verification

**Files:**
- Modify: `AGENTS.md` (repo root of Home-ai)

**Interfaces:**
- Consumes: nothing. Produces: documentation only.

- [ ] **Step 1: Check the other session's state before touching AGENTS.md**

Run: `git status --short` and `git log --oneline -3`.
Expected: if `AGENTS.md` is listed as modified (M) by the other session, STOP and report to the user — do not clobber their uncommitted edits. If clean, proceed.

- [ ] **Step 2: Update the "Current Dashboard Snapshot"**

Add this bullet at the TOP of the snapshot list (before the existing "Last Updated" bullets):

```markdown
- **Last Updated:** 2026-08-31 | **Weather card stays live on its own — 15-minute auto-refresh + tab-wake refresh.** The widget no longer freezes at whatever the page loaded with: the Open-Meteo fetch is now a stable `loadWeather` callback that runs on mount, every 15 minutes, and immediately when the browser tab becomes visible again with data older than 10 minutes. Refreshes are silent — the card keeps showing current data while the new forecast loads (no skeleton flash; the temperature just counts to the new value when it lands), and a background failure keeps the stale data with no error banner (the "Weather unavailable" banner now only appears when there is no data at all, i.e., the initial fetch failed). An in-flight guard skips overlapping refreshes. `updatedAt` still only advances on success, so "Updated Xm ago" stays honest. The details modal stays live automatically (same `weatherData` state). Design: `docs/superpowers/specs/2026-08-31-weather-live-refresh-design.md`; plan: `docs/superpowers/plans/2026-08-31-weather-live-refresh.md`. Verified: typecheck clean, eslint clean on touched files, suite 656/656 (+5 tests: 15-min poll, stale tab-wake refetch, fresh tab-wake no-op, silent in-flight refresh, background-failure keeps data).
```

(Adjust the test count `656/656` to the ACTUAL number printed by `npx vitest run` in Task 4 Step 5 before committing — never commit a wrong count.)

- [ ] **Step 3: Add a UI Change Record entry**

Add under the existing "### UI Change Record" entries (after the 2026-08-31 weather polish entry):

```markdown
### UI Change Record — 2026-08-31 — Weather card stays live: 15-min auto-refresh + tab-wake refresh
- Added / Changed: `src/components/ui/WeatherWidget.tsx` — the mount-only Open-Meteo fetch effect became a stable `loadWeather()` callback (in-flight guard via `useRef`) invoked on mount, on a 15-minute `setInterval`, and from an extended `visibilitychange` listener when the tab returns visible with data older than 10 minutes. Success sets `updatedAt` + a matching ref; `.catch` now only surfaces the "Weather unavailable" banner (and stops the loading skeleton) when no data has ever loaded — background failures keep the stale data silently and retry on the next cycle. The 60s freshness tick, particle-pause visibility handling, and location-change refetch deps are untouched. `tests/unit/weather-widget.test.tsx` (+5: 15-min poll, stale wake refetch, fresh wake no-op, silent in-flight refresh with data swap, background failure keeps data + no banner).
- Visual / Motion: No visual change — refreshes are invisible by design. The card holds its current temperature and scene while the new forecast loads, then the number simply counts to the new value (existing 550ms count-up; instant under `prefers-reduced-motion`). No skeleton flash on refresh; the loading skeleton remains first-load-only. "Updated Xm ago" keeps ticking and resets on every successful fetch.
- Color sources: None — no palette changes.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log.
- User-facing description (copy-paste ready for responses):
  > "The weather card now keeps itself up to date. It quietly refreshes every 15 minutes, and if you leave the tab and come back later it grabs fresh weather right away when the data is more than 10 minutes old. Nothing flashes or disappears while it updates — the temperature just settles to the new number. The 'Updated Xm ago' line now always reflects a real refresh, and the details view stays current too."
```

- [ ] **Step 4: Add a Change Log entry**

Under "## Change Log (this manual only)" (the most recent one — there are duplicate headers in the file; add to the FIRST Change Log section after the UI Change Records), add:

```markdown
- 2026-08-31 — feat(weather): widget stays live — 15-min auto-refresh + tab-wake refresh (spec docs/superpowers/specs/2026-08-31-weather-live-refresh-design.md). `src/components/ui/WeatherWidget.tsx` — mount-only fetch extracted into `loadWeather()` (`useCallback` on lat/lon, `inFlightRef` overlap guard) and now also runs every 15 min (`setInterval`) and on `visibilitychange` when the tab returns visible with `updatedAt` > 10 min old (`updatedAtRef` mirrors the success timestamp). Silent refresh: `loading` only ever shows before first data; background failure keeps stale data with no banner (`.catch` gated on `dataLoadedRef`) and retries next cycle. Modal auto-live via shared `weatherData`. `tests/unit/weather-widget.test.tsx` +5 (poll, stale/fresh wake, silent in-flight swap, failure-keeps-data). Verified: typecheck clean, eslint clean on touched files, suite 656/656.
```

- [ ] **Step 5: Final verification**

Run: `npx vitest run` (full suite — note the real count), `npm run typecheck`, `npx eslint src/components/ui/WeatherWidget.tsx tests/unit/weather-widget.test.tsx`.
Expected: all green. If the AGENTS.md counts in Step 2/4 don't match the printed total, fix them NOW.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — weather live-refresh records"
```

- [ ] **Step 7: Report (no deploy)**

Expected outcome: 5 commits on `warm-glass-v2` (refactor, 15-min poll, tab-wake, silent refresh, docs). Working tree left clean of Instacart-session files. NO `git push`, NO NAS deploy — the user holds deployment until the Instacart session finishes.

---

## Self-Review Notes

- Spec coverage: 15-min interval → Task 2; tab-wake >10 min → Task 3; silent refresh/no skeleton → Task 4 (test 1); background failure keeps data/no banner → Task 4 (test 2); in-flight guard → Task 1; `updatedAt` success-only → Task 1/3 (unchanged behavior + ref); modal auto-live → no code (shared state, documented in Task 5); AGENTS.md → Task 5; no deploy → Task 5 Step 7; design doc already committed (`8a2caed`).
- Placeholder scan: none — all code blocks are complete; the only variable is the test-count number, which Task 5 Step 2/5 explicitly requires to be corrected to the real output before commit.
- Type consistency: `loadWeather`, `inFlightRef`, `updatedAtRef`, `dataLoadedRef` — same names in every task; thresholds `15 * 60_000` / `10 * 60_000` verbatim everywhere.
