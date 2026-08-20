"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One-shot deep-link query consumer for the chat page.
 *
 * When a user lands on /chat?q=... (e.g. from the Home prompt chips), the
 * page stores the query, strips it from the URL immediately (so a reload
 * doesn't re-send it), and fires it exactly once — but only after the chat
 * thread has finished hydrating, so the message history is complete when
 * the query is sent.
 */
export function usePendingChatQuery(
  queryParam: string | null,
  hydrated: boolean,
  onQuery: (q: string) => void
) {
  // The page mounts fresh on navigation, so the query param is captured as
  // the initial state — no effect-driven setState (avoids cascading renders).
  const [pendingQuery, setPendingQuery] = useState<string | null>(() => queryParam);
  const firedRef = useRef(false);

  // Strip the query from the URL right away so a reload doesn't re-send it.
  useEffect(() => {
    if (!queryParam) return;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      window.history.replaceState({}, "", url.toString());
    }
  }, [queryParam]);

  // Fire exactly once, only after the thread is hydrated.
  useEffect(() => {
    if (!hydrated || !pendingQuery || firedRef.current) return;
    firedRef.current = true;
    const q = pendingQuery;
    setPendingQuery(null);
    onQuery(q);
  }, [hydrated, pendingQuery, onQuery]);

  return { pendingQuery };
}