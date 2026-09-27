"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyReadError,
  readMessageFor,
  readStateForRows,
  type ReadFailure,
  type SafeState,
} from "@/lib/read-state";

/**
 * useSafeFetch — the read hook that answers "why is this missing?".
 *
 * Audit P0-4: the app's failure handling was a no-op catch in 31 places,
 * which turns a dead NAS, a signed-out browser and a genuinely quiet day into
 * the same screen. This hook makes those three render differently, keeps the
 * last good data instead of blanking a wall display, and always exposes a
 * `retry` the UI can wire to a real button.
 *
 * Conventions that matter:
 * - `key` (a string) is the reactive input. Changing it starts a fresh read and
 *   — because the old data is now about the wrong thing (a different location,
 *   a different week) — clears `data`/`loaded`. Pass a stable `key` to keep
 *   data across refreshes.
 * - Never show a spinner forever: `state === "loading"` is only reachable while
 *   a read is genuinely in flight and nothing has loaded yet.
 */
export interface UseSafeFetchOptions<T> {
  initial: T;
  /** Reactive input. Changing it re-reads and drops the previous data. */
  key?: string;
  /** Decide `empty` vs `ready` for a successful read. Default: array length. */
  isEmpty?: (data: T) => boolean;
  /** Slow heartbeat for wall screens (they sit open for hours). */
  refreshMs?: number;
  /** Skip the read entirely (e.g. waiting for runtime config to land). */
  enabled?: boolean;
}

export interface SafeFetch<T> {
  state: SafeState;
  data: T;
  /** at least one read succeeded — drives "showing your saved copy" honesty */
  loaded: boolean;
  /** `loaded`, but the most recent read failed */
  stale: boolean;
  /** a refresh is in flight while usable data is already on screen */
  refreshing: boolean;
  /** honest copy for the current failure state, `null` when nothing is wrong */
  message: string | null;
  /**
   * The current failure, already narrowed: `{failure && <ReadStatePill state={failure} …>}`
   * type-checks, which `{isFailure && …}` does not (the pill refuses `loading`).
   */
  failure: ReadFailure | null;
  /** Usable payload on screen — so a failure can be shown as stale instead of fatal. */
  hasData: boolean;
  retry: () => void;
}

export function useSafeFetch<T>(
  read: () => Promise<T>,
  options: UseSafeFetchOptions<T>,
): SafeFetch<T> {
  const { initial, key = "", isEmpty, refreshMs, enabled = true } = options;

  const [data, setData] = useState<T>(initial);
  const [state, setState] = useState<SafeState>("loading");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest read/isEmpty without re-triggering the read effect on every render.
  // Assigned in an effect (never during render — `react-hooks/refs`), and
  // declared BEFORE the read effect so the first run sees the real callback.
  const readRef = useRef(read);
  const isEmptyRef = useRef(isEmpty);
  useEffect(() => {
    readRef.current = read;
    isEmptyRef.current = isEmpty;
  });

  const runIdRef = useRef(0);
  const loadedRef = useRef(false);
  const keyRef = useRef<string | null>(null);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      runIdRef.current += 1; // retire whatever read was in flight
      return;
    }

    // A new key means the previous data describes something else (new location,
    // new week). Drop it rather than render it as if it were current.
    if (keyRef.current !== key) {
      keyRef.current = key;
      if (loadedRef.current) {
        loadedRef.current = false;
        setLoaded(false);
        setData(initial);
      }
    }

    const runId = ++runIdRef.current;
    const isCurrent = () => runId === runIdRef.current;

    const isFirstRead = !loadedRef.current;
    if (isFirstRead) setState("loading");
    else setRefreshing(true);

    const perform = async () => {
      try {
        const value = await readRef.current();
        if (!isCurrent()) return;
        loadedRef.current = true;
        setData(value);
        setLoaded(true);
        setState(isEmptyRef.current
          ? (isEmptyRef.current(value) ? "empty" : "ready")
          : (Array.isArray(value) ? readStateForRows(value) : "ready"));
        setMessage(null);
      } catch (err) {
        if (!isCurrent()) return;
        const failure: ReadFailure = classifyReadError(err);
        setState(failure);
        setMessage(readMessageFor(failure, loadedRef.current));
      } finally {
        if (isCurrent()) setRefreshing(false);
      }
    };

    void perform();

    const timers: ReturnType<typeof setInterval>[] = [];
    if (refreshMs && refreshMs > 0) timers.push(setInterval(() => void perform(), refreshMs));

    // Coming back to the network should heal the screen without a reload.
    const onOnline = () => void perform();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshMs && refreshMs > 0) void perform();
      else if (!loadedRef.current) void perform();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      runIdRef.current += 1; // retire this run so late answers are ignored
      timers.forEach(clearInterval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      setRefreshing(false);
    };
    // `initial` is read only when the key changes; it is not a reactive input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, enabled, refreshMs]);

  const stale = loaded && (state === "offline" || state === "unauthorised" || state === "error");
  const failure: ReadFailure | null =
    state === "loading" || state === "ready" ? null : state;

  return {
    state,
    data,
    loaded,
    stale,
    refreshing,
    message,
    /** Every state `ReadStatePill` can render — `null` while loading or ready. */
    failure,
    /** Usable payload on screen, so a failure below it reads as stale, not fatal. */
    hasData: loaded && (data as unknown) !== null && (data as unknown) !== undefined,
    retry,
  };
}
