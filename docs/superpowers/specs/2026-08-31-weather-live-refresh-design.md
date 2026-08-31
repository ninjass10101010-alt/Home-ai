# Weather Widget Live Refresh — Design

**Date:** 2026-08-31
**Status:** Approved
**Scope:** `Home-ai` — `src/components/ui/WeatherWidget.tsx` + tests + AGENTS.md

## Context

The Home weather card fetches Open-Meteo exactly once, on mount (`useEffect` at `WeatherWidget.tsx:557-636`, deps = weather location lat/lon). The 60s interval at line 651 only re-renders the "Updated Xm ago" footer; the `visibilitychange` listener at line 655 only pauses particles. On a family dashboard left open all day (kitchen tablet, Nest Hub), the temperature, condition, H/L, hourly strip, and forecast go stale until someone reloads the page — while the footer honestly reports "Updated 3h ago".

User-confirmed requirement: the widget should stay live on its own.

## Goal

Weather data refreshes automatically every 15 minutes, plus immediately when the browser tab becomes visible again with stale data. Refreshes are silent — no skeleton flash, no loading state — and never lose the data already on screen.

## Approach (approved: A — in-component refetch)

Extract the existing fetch block into a stable `loadWeather()` callback inside `WeatherWidget.tsx`, then hang two new triggers on it:

1. **15-minute interval** — `setInterval(loadWeather, 15 * 60_000)`, cleared on unmount.
2. **Tab-wake refresh** — extend the existing `visibilitychange` listener: when `document.hidden` flips to visible AND `updatedAt` is older than 10 minutes, call `loadWeather()` immediately.

No new files, no new dependencies. The widget already owns its fetching, its timers, and its freshness footer — the change stays inside the one component.

## Behavior Spec

### Fetch lifecycle
- First fetch on mount: unchanged (shows the existing loading state until data lands or fails).
- Subsequent fetches (interval or wake): **silent**. Current `weatherData` keeps rendering; when the response lands, state updates and the temperature counts up/down via its existing animation. `loading` must NOT flip true on background refreshes.
- **In-flight guard:** a `useRef` flag set before each fetch and cleared in `.finally()`. If a refresh fires while one is already running, it is skipped. Prevents stacking requests when an interval tick and a tab-wake coincide.

### Freshness
- `updatedAt` advances only on a successful fetch — the "Updated Xm ago" footer stays honest and the 60s tick keeps working unchanged.
- Staleness for the wake check is measured against `updatedAt` (last success), not last attempt. A failed background refresh therefore still triggers a wake refetch next time the tab returns.

### Error handling
- **Background refresh fails:** keep the stale data silently, clear the in-flight flag, retry on the next cycle. No error banner while data exists — the card is still showing the last known weather, which is correct and calm.
- **Initial fetch fails (no data):** unchanged — existing `fetchError` banner ("Weather unavailable…") shows, and the next interval/wake refresh retries (and clears it on success).
- Success clears `fetchError` (already does via `setFetchError(null)`).

### Scope notes
- The details modal needs zero extra work: it reads the same `weatherData` state, so it stays live automatically.
- Location changes: the effect deps stay `[lat, lon]` — `loadWeather` is a `useCallback` keyed on them, and both new triggers reference it, so a changed location still re-fetches immediately and re-binds the triggers.
- The existing `tabHidden` state (particle pause) is untouched.

## Testing (TDD — `tests/unit/weather-widget.test.tsx`)

Using `vi.useFakeTimers()` + the existing mocked `fetch`:

1. **15-min interval refetch** — advance timers 15 min → `fetch` called again.
2. **Tab-wake refetch when stale** — dispatch `visibilitychange` with `updatedAt` > 10 min old → `fetch` called.
3. **No refetch on wake when fresh** — `updatedAt` < 10 min old → `fetch` NOT called.
4. **Silent refresh** — during a background refresh, no loading state renders; existing data stays on screen.
5. **Background failure keeps data** — second fetch rejects → no error banner, previous data still rendered, `updatedAt` unchanged.
6. **Overlap guard** — a refresh that fires while a fetch is in flight does not issue a second request.
7. Existing suite (651 tests incl. wind arrow / feels-like / scene tests) must stay green.

## Documentation

- AGENTS.md: "Current Dashboard Snapshot" entry, UI Change Record entry, Change Log entry — per the mandatory update rule.

## Deploy

**Held.** The Instacart session is still working in this repo; no NAS deploy until it's done. Code lands on `warm-glass-v2` locally, verified (typecheck, eslint, full suite), and ships with the next combined deploy.

## Non-Goals

- No polling frequency settings UI (15 min is fixed and fine).
- No SWR/TanStack Query or any new dependency.
- No changes to the fetch URL, scene, or any visual design.
- No refactor of the widget's fetch into a hook (evaluated; rejected for minimal diff while another session is active in the repo).
