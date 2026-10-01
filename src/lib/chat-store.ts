"use client";

/**
 * Ask Consuela chat store — a module-level observable singleton.
 *
 * Why a module store instead of component state: the chat page unmounts on
 * every tab navigation, but an LLM stream can run for minutes. With
 * component-local state a reply that landed while the user was on another tab
 * was written into a dead component and only reappeared after a remount
 * refetched PocketBase. This store owns the messages + the live stream, so
 * navigating away interrupts nothing and returning re-attaches instantly.
 *
 * React consumes it via useSyncExternalStore (same idiom as
 * calendar-member-snapshot.ts).
 */

import { streamConsuelaChat } from "@/lib/chat-stream";
import { mergeThread, SEED_GREETING_ID } from "@/lib/chat-thread";
import {
  isPointAdjustmentProposal,
  type PointAdjustmentProposal,
} from "@/components/chat/AdjustPointsChip";

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  /** Epoch ms — the deterministic sort key (see chat-thread.sortThread). */
  at: number;
  speaker?: string;
  speakerEmoji?: string;
  errorFor?: string;
  /** Telegram-mirrored row — wears an origin badge in the thread. */
  source?: "telegram";
  /** Inert point-adjustment proposals; points move only via the chip's PIN. */
  proposals?: PointAdjustmentProposal[];
}

export interface ChatSpeaker {
  name: string;
  emoji: string;
}

export interface ChatStoreState {
  messages: Message[];
  isTyping: boolean;
  statusLine: string | null;
  hydrated: boolean;
  /** True for the ENTIRE stream (send start → finally). `isTyping` drops on
   *  the first token, so it cannot double as the composer's busy flag. */
  streaming: boolean;
}

const CHAT_STORAGE_KEY = "consuela-chat-messages";
// Short beat so the typing bubble doesn't flash on instant buffered replies.
const MIN_THINKING_DELAY = 400;

const initialGreeting: Message = {
  id: SEED_GREETING_ID,
  role: "assistant",
  content: "What can I help you with today? 🏡",
  timestamp: "Now",
  at: 0,
};

function freshState(): ChatStoreState {
  return {
    messages: [initialGreeting],
    isTyping: false,
    statusLine: null,
    hydrated: false,
    streaming: false,
  };
}

let state: ChatStoreState = freshState();
/** Deterministic SSR/hydration snapshot — the client's first render must match. */
const SERVER_STATE: ChatStoreState = freshState();

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<ChatStoreState>) {
  state = { ...state, ...patch };
  notify();
}

function setMessages(next: Message[] | ((prev: Message[]) => Message[])) {
  const messages = typeof next === "function" ? next(state.messages) : next;
  state = { ...state, messages };
  persistHistory();
  notify();
}

/**
 * Persist to localStorage once hydration is done. The seed greeting is never
 * stored — it is re-seeded on load, and keeping it would put a phantom row at
 * the top of the stored thread.
 */
function persistHistory() {
  if (!state.hydrated || typeof window === "undefined") return;
  const isSeedGreeting = (m: Message) =>
    m.id === SEED_GREETING_ID && m.role === "assistant" && m.content === initialGreeting.content;
  try {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(state.messages.filter((m) => !isSeedGreeting(m))),
    );
  } catch {
    /* quota / private mode — the server thread is the durable copy */
  }
}

function loadChatHistory(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize legacy rows written before `at` existed so ordering stays sane.
    return parsed.map((m: any) => ({ ...m, at: typeof m.at === "number" ? m.at : 0 }));
  } catch {
    return [];
  }
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Floor of the PocketBase synthetic-id space. Optimistic ids stay STRICTLY
 * BELOW it so the two spaces are disjoint by construction — `reseedOptimisticCounter`
 * filters against this constant, not against the live counter (which has
 * already advanced past the ids it just handed out).
 */
const PB_SYNTHETIC_ID_BASE = 2_000_000;

/**
 * Hard upper bound of the optimistic range. Nothing this module issues gets
 * near it — the only writers are the seed greeting, then a few hundred
 * allocations climbing from 100 — so an id at or above this line in a stored
 * payload is FOREIGN: another app's ids, or a migration that renumbered a
 * thread. The reseed reads those rows as no input at all, and the allocation
 * seam refuses to climb past here. Exported for the id-space tests.
 */
export const OPTIMISTIC_ID_CEILING = PB_SYNTHETIC_ID_BASE - 1_000;

// Synthetic ids for PB-hydrated rows must be unique ACROSS reconciles, not
// just within one fetch — a per-fetch index collides and duplicate React keys
// break list diffing. Monotonic module counter.
let pbSyntheticIdCounter = PB_SYNTHETIC_ID_BASE;

async function fetchPBThread(
  sinceISO?: string,
): Promise<{ messages: Message[]; latest: string | null }> {
  try {
    const params = new URLSearchParams({ threadId: todayISO() });
    if (sinceISO) params.set("since", sinceISO);
    const res = await fetch(`/api/chat/messages?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return { messages: [], latest: null };
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.messages)) return { messages: [], latest: null };
    let latest: string | null = null;
    const messages = json.messages.map((m: any) => {
      if (m.createdAt && (!latest || String(m.createdAt) > latest)) latest = String(m.createdAt);
      return {
        id: pbSyntheticIdCounter++,
        role: m.role === "user" ? ("user" as const) : m.role === "system" ? ("system" as const) : ("assistant" as const),
        content: m.content || "",
        timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        at: Date.parse(m.createdAt) || 0,
        ...(m.role === "user" && m.userId ? { speaker: m.userId } : {}),
        ...(m.source === "telegram" ? { source: "telegram" as const } : {}),
      };
    });
    return { messages, latest };
  } catch {
    return { messages: [], latest: null };
  }
}

// Internal mutable "refs" (module-scoped).
let hydratedOnce = false;
let msgCounter = 100;
let lastPBCreated: string | null = null;
let streamInFlight = false;
let abortController: AbortController | null = null;

/**
 * Optimistic ids must never collide with rows rehydrated from localStorage.
 * `persistHistory()` keeps prior sessions' messages (ids 101, 102, …) while
 * msgCounter starts at 100 every page load — so a fresh reply row could land
 * on a stale row and OVERWRITE it instead of appending. Reseeding above every
 * merged id fixes it; PB ids live at PB_SYNTHETIC_ID_BASE+ and stay disjoint by
 * construction.
 *
 * Two guards, because rows only exist once they materialize: the reseed is
 * MONOTONIC (ids already handed out — e.g. a reply row reserved before its
 * first token — must not be re-issued), and it reads ONLY ids inside the
 * optimistic range, so a hand-edited or migrated localStorage id seeds nothing.
 * The ceiling itself is held by nextOptimisticId, below.
 */
function reseedOptimisticCounter(rows: Message[]): void {
  let max = 100;
  for (const m of rows) {
    // The range check is load-bearing: `persistHistory()` writes PB-synthetic
    // rows too, so every real payload holds ids >= PB_SYNTHETIC_ID_BASE — let
    // one seed the counter and the very next page load allocates in PB space.
    // The `typeof` guard is load-bearing for a different reason:
    // `loadChatHistory()` casts rows to `any`, so a single string id makes
    // Math.max return NaN and pins msgCounter to NaN for the whole page load.
    if (typeof m.id !== "number" || m.id >= OPTIMISTIC_ID_CEILING) continue;
    max = Math.max(max, m.id);
  }
  // Monotonic: ids already handed out this load — e.g. a reply row reserved
  // before its first token — must not be re-issued.
  msgCounter = Math.max(msgCounter, max + 1);
}

/**
 * The single allocation seam for optimistic ids, and where the disjointness
 * invariant is actually ENFORCED. The reseed cannot hold it by itself: it
 * legitimately places msgCounter AT the ceiling (a stored id one below it is
 * in range, so max + 1 === OPTIMISTIC_ID_CEILING), and the next allocation
 * would cross into PB space.
 *
 * Saturates instead of crossing. A duplicate optimistic id is a visible glitch
 * in an already-degenerate state; an id that collides with a PB row is the
 * overwrite bug this whole scheme exists to prevent.
 */
function nextOptimisticId(): number {
  msgCounter = Math.min(msgCounter + 1, OPTIMISTIC_ID_CEILING);
  return msgCounter;
}

/** Re-read 10 min behind the watermark so backdated Telegram rows still land. */
function safetySince(): string | undefined {
  return lastPBCreated
    ? new Date(Date.parse(lastPBCreated) - 10 * 60 * 1000).toISOString()
    : undefined;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ChatStoreState {
  return state;
}

export function getServerSnapshot(): ChatStoreState {
  return SERVER_STATE;
}

/**
 * Read the thread once per page load (localStorage + the full PB day), then
 * only incremental since-reads on later mounts. Fully guarded so a StrictMode
 * double-mount cannot double-fetch.
 */
export async function ensureHydrated(): Promise<void> {
  if (!hydratedOnce) {
    hydratedOnce = true;
    // MERGE (never replace): a send that raced this read must survive.
    const saved = loadChatHistory();
    if (saved.length > 0) setMessages((prev) => mergeThread(prev, saved));
    const { messages: pbMsgs, latest } = await fetchPBThread();
    if (latest) lastPBCreated = latest;
    setMessages((prev) => mergeThread(prev, pbMsgs.length > 0 ? pbMsgs : loadChatHistory()));
    reseedOptimisticCounter(state.messages);
    setState({ hydrated: true });
    return;
  }
  // Remount while already hydrated: cheap incremental reconcile (catches
  // Telegram / other-device rows) unless a live stream owns the thread now.
  if (!streamInFlight && state.hydrated) {
    const { messages: fresh, latest } = await fetchPBThread(safetySince());
    if (latest) lastPBCreated = latest;
    if (fresh.length > 0) setMessages((prev) => mergeThread(prev, fresh));
  }
}

function isResetCommand(text: string) {
  return /^\/(new|restart)$/i.test(text.trim());
}

export async function send(text: string, speaker: ChatSpeaker): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || state.isTyping || streamInFlight) return;
  if (isResetCommand(trimmed)) {
    await startNewConversation();
    return;
  }

  streamInFlight = true;
  setState({ streaming: true });
  const controller = new AbortController();
  abortController = controller;

  // The pre-send thread. Captured BEFORE the optimistic user row is appended:
  // the model must not receive the current message twice (it travels as
  // `message`), matching the previous messagesRef.current semantics.
  const modelSource = state.messages;

  const userAt = Date.now();
  const userMsg: Message = {
    id: nextOptimisticId(),
    role: "user",
    content: trimmed,
    timestamp: "Just now",
    at: userAt,
    speaker: speaker.name,
    speakerEmoji: speaker.emoji,
  };
  setMessages((prev) => [...prev, userMsg]);
  setState({ isTyping: true, statusLine: null });

  const streamId = nextOptimisticId();
  // +1 so the reply sorts after its request even if both land in the same ms.
  const streamAt = userAt + 1;
  let bubbleOpen = false;
  // Whatever streamed before a stop/failure — a stopped reply keeps its words.
  let streamedSoFar = "";
  // Proposals surfaced during THIS turn. Inert: only the chip's PIN flow writes.
  const turnProposals: PointAdjustmentProposal[] = [];
  const attachProposal = (value: unknown) => {
    if (!isPointAdjustmentProposal(value)) return;
    const dupe = turnProposals.some(
      (p) =>
        p.args.member === value.args.member &&
        p.args.delta === value.args.delta &&
        p.args.reason === value.args.reason,
    );
    if (dupe) return;
    turnProposals.push(value);
    setMessages((prev) =>
      prev.some((m) => m.id === streamId)
        ? prev.map((m) => (m.id === streamId ? { ...m, proposals: [...turnProposals] } : m))
        : prev,
    );
  };

  try {
    const t0 = Date.now();
    // Context steering: the model only sees messages AFTER the newest reset
    // marker — a /new conversation starts with a clean brain.
    const lastResetIdx = modelSource.map((m) => m.role).lastIndexOf("system");
    const modelHistory = (lastResetIdx >= 0 ? modelSource.slice(lastResetIdx + 1) : modelSource)
      .slice(-12)
      .map((m) => ({
        role: m.role,
        content:
          m.role === "assistant" ? m.content.replace(/\n\n✅[\s\S]*$/, "").trim() : m.content,
      }));

    const result = await streamConsuelaChat({
      message: trimmed,
      history: modelHistory,
      signal: controller.signal,
      onStatus: (label: string, data?: Record<string, unknown>) => {
        setState({ statusLine: label });
        attachProposal(data?.proposal);
      },
      onToken: (full: string) => {
        streamedSoFar = full;
        if (!bubbleOpen) {
          bubbleOpen = true;
          setState({ isTyping: false });
        }
        setMessages((prev) =>
          prev.some((m) => m.id === streamId)
            ? prev.map((m) => (m.id === streamId ? { ...m, content: full } : m))
            : [
                ...prev,
                {
                  id: streamId,
                  role: "assistant" as const,
                  content: full,
                  timestamp: "Just now",
                  at: streamAt,
                  ...(turnProposals.length ? { proposals: [...turnProposals] } : {}),
                },
              ],
        );
      },
    });
    // Buffered (non-streamed) path: proposals arrive as a top-level array.
    for (const p of Array.isArray(result.proposals) ? result.proposals : []) attachProposal(p);
    const { content, streamed } = result;

    // Buffered fallback keeps a short beat so the bubble doesn't flash;
    // streamed replies already rendered live.
    if (!streamed) {
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_THINKING_DELAY) {
        await new Promise((r) => setTimeout(r, MIN_THINKING_DELAY - elapsed));
      }
    }
    setState({ isTyping: false, statusLine: null });

    const finalContent = content || "I processed that.";
    setMessages((prev) =>
      prev.some((m) => m.id === streamId)
        ? prev.map((m) =>
            m.id === streamId
              ? {
                  ...m,
                  content: finalContent,
                  proposals:
                    m.proposals ?? (turnProposals.length ? [...turnProposals] : undefined),
                }
              : m,
          )
        : [
            ...prev,
            {
              id: streamId,
              role: "assistant" as const,
              content: finalContent,
              timestamp: "Just now",
              at: streamAt,
              ...(turnProposals.length ? { proposals: [...turnProposals] } : {}),
            },
          ],
    );

    // Reconcile against PB (picks up rows that arrived on other devices).
    const { messages: fresh, latest } = await fetchPBThread(safetySince());
    if (latest) lastPBCreated = latest;
    if (fresh.length > 0) setMessages((prev) => mergeThread(prev, fresh));
  } catch (error) {
    setState({ isTyping: false, statusLine: null });
    if (controller.signal.aborted) {
      // User pressed stop — not an error. Keep whatever streamed; if nothing
      // did, say so plainly instead of dropping a silent hole in the thread.
      const stoppedContent = streamedSoFar.trim() || "Stopped.";
      setMessages((prev) =>
        prev.some((m) => m.id === streamId)
          ? prev.map((m) =>
              m.id === streamId
                ? {
                    ...m,
                    content: stoppedContent,
                    proposals:
                      m.proposals ?? (turnProposals.length ? [...turnProposals] : undefined),
                  }
                : m,
            )
          : [
              ...prev,
              {
                id: streamId,
                role: "assistant" as const,
                content: stoppedContent,
                timestamp: "Just now",
                at: streamAt,
                ...(turnProposals.length ? { proposals: [...turnProposals] } : {}),
              },
            ],
      );
    } else if (error instanceof Error && error.name === "RouteChatError") {
      // The route got far enough to answer with something specific ("My brain
      // isn't configured yet — add a provider in Settings → AI Models.").
      // Showing outage copy over it would bury the one actionable sentence.
      // errorFor is kept so "Try again" still works: retrying is the right move
      // after the parent configures a provider.
      setMessages((prev) => [
        ...prev,
        {
          id: nextOptimisticId(),
          role: "assistant",
          content: error.message,
          timestamp: "Just now",
          at: Date.now(),
          errorFor: trimmed,
        },
      ]);
    } else {
      // Honest failure: name the problem (offline vs server) and the recovery.
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const failedContent = offline
        ? "You're offline — I can't reach the family server right now. Check the connection and try again."
        : "I couldn't reach the family server just now. Your message is still here — try again in a moment.";
      setMessages((prev) => [
        ...prev,
        {
          id: nextOptimisticId(),
          role: "assistant",
          content: failedContent,
          timestamp: "Just now",
          at: Date.now(),
          errorFor: trimmed,
        },
      ]);
    }
  } finally {
    abortController = null;
    streamInFlight = false;
    setState({ streaming: false });
  }
}

export function stop(): void {
  abortController?.abort();
}

/**
 * Conversation steering: an optimistic local "New conversation" marker (the
 * visible divider + the LLM context cutoff) plus a best-effort PB reset row.
 * Guests 401 here — the local divider still shows, honestly.
 */
export async function startNewConversation(): Promise<void> {
  const marker: Message = {
    id: nextOptimisticId(),
    role: "system",
    content: "New conversation",
    timestamp: "Just now",
    at: Date.now(),
  };
  setMessages((prev) => [...prev, marker]);
  try {
    await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
  } catch {
    /* offline — local divider only */
  }
}

export function retry(failedText: string, failedId: number, speaker: ChatSpeaker): void {
  // Never remove the failed bubble unless the retry will actually run.
  if (state.isTyping || streamInFlight) return;
  setMessages((prev) => prev.filter((m) => m.id !== failedId));
  void send(failedText, speaker);
}

/** Test-only: reset the module singleton between tests. */
export function __resetChatStoreForTests(): void {
  state = freshState();
  hydratedOnce = false;
  msgCounter = 100;
  pbSyntheticIdCounter = PB_SYNTHETIC_ID_BASE;
  lastPBCreated = null;
  streamInFlight = false;
  abortController = null;
  listeners.clear();
}
