"use client";

import { useCallback, useRef, useState } from "react";
import type { MediaTrack } from "@/lib/media/youtube";

/**
 * MediaSearch — debounced YouTube Music lookup for the player surfaces.
 *
 * Server-side on purpose: the signed-URL machinery and guest cookie in
 * `lib/media/youtube` must never reach the browser, so search goes through
 * `/api/media/search` rather than calling Innertube from the client.
 *
 * `tick` exists so an in-flight response that arrives after a newer keystroke
 * can be discarded — without it, typing "daft pun…" then "daft punk" can leave
 * the older, shorter result set on screen.
 */

export interface MediaSearchResult {
  query: string;
  tracks: MediaTrack[];
  error: string | null;
  loading: boolean;
}

/** Matches what a family member can comfortably type before we hit the API. */
const MIN_QUERY_LENGTH = 2;

/** Long enough to skip intermediate keystrokes, short enough to feel live. */
const DEBOUNCE_MS = 350;

/** Older requests than this are stale even if they arrive first. */
const MAX_REQUEST_MS = 10_000;

export interface UseMediaSearchResult extends MediaSearchResult {
  search: (query: string) => void;
  clear: () => void;
}

export function useMediaSearch(): UseMediaSearchResult {
  const [result, setResult] = useState<MediaSearchResult>({
    query: "",
    tracks: [],
    error: null,
    loading: false,
  });
  const requestId = useRef(0);

  const search = useCallback((query: string) => {
    const trimmed = query.trim();
    const id = ++requestId.current;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResult({ query: trimmed, tracks: [], error: null, loading: false });
      return;
    }

    setResult((prev) => ({ ...prev, query: trimmed, loading: true, error: null }));

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MAX_REQUEST_MS);
      try {
        const response = await fetch(
          `/api/media/search?q=${encodeURIComponent(trimmed)}&limit=12`,
          { signal: controller.signal },
        );
        const body = (await response.json().catch(() => null)) as
          | { tracks?: MediaTrack[]; error?: string; detail?: string }
          | null;

        // A newer keystroke has already claimed the screen — drop this result.
        if (id !== requestId.current) return;

        if (!response.ok || !body?.tracks) {
          setResult({
            query: trimmed,
            tracks: [],
            error: body?.detail || "Music search is unavailable right now.",
            loading: false,
          });
          return;
        }
        setResult({ query: trimmed, tracks: body.tracks, error: null, loading: false });
      } catch {
        if (id !== requestId.current) return;
        // An abort is our own timeout, not a failure worth shouting about.
        setResult({
          query: trimmed,
          tracks: [],
          error: controller.signal.aborted ? null : "Music search is unavailable right now.",
          loading: false,
        });
      } finally {
        clearTimeout(timeout);
      }
    }, DEBOUNCE_MS);

    // Nothing to cancel on unmount here — the request-id guard covers staleness
    // and the component is always mounted for the session.
    return () => clearTimeout(timer);
  }, []);

  const clear = useCallback(() => {
    requestId.current += 1;
    setResult({ query: "", tracks: [], error: null, loading: false });
  }, []);

  return { ...result, search, clear };
}
