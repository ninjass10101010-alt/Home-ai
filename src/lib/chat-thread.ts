/**
 * Pure thread-ordering helpers for the Ask Consuela screen.
 *
 * The chat thread is assembled from several sources that can land in any order
 * (PB hydration, optimistic sends, streamed replies, cross-device/Telegram
 * reconciles). These helpers make the visible order depend on a message's
 * timestamp — never on the order rows happened to be merged in.
 */

/** The seed greeting the page renders before any real message exists. */
export const SEED_GREETING_ID = 1;

interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  at?: number;
}

/** Tie-break order when two rows share a timestamp: request before reply. */
const ROLE_RANK: Record<string, number> = { user: 0, system: 1, assistant: 2 };

/**
 * Dedupe key. Deliberately omits `speaker`: a signed-out optimistic user row
 * carries the selected member name while its persisted PB row maps to "guest",
 * so including the speaker left a duplicate behind. Count semantics in
 * `mergeThread` still keep genuine repeated messages.
 */
export function threadKey(m: { role: string; content: string }): string {
  return `${m.role}\u0000${m.content}`;
}

/** Stable ascending sort by `at`; ties break request → divider → reply. */
export function sortThread<T extends ThreadMessage>(msgs: T[]): T[] {
  return msgs
    .map((m, index) => ({ m, index }))
    .sort((a, b) => {
      const atA = a.m.at ?? 0;
      const atB = b.m.at ?? 0;
      if (atA !== atB) return atA - atB;
      const rankA = ROLE_RANK[a.m.role] ?? 1;
      const rankB = ROLE_RANK[b.m.role] ?? 1;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map(({ m }) => m);
}

/**
 * Additive multiset union by `threadKey`. Keeps the existing row (it carries
 * UI-only fields like `proposals` / `errorFor`) and never removes anything —
 * so a hydration fetch that lands mid-send can never drop an optimistic message.
 * Callers own the final order via `sortThread`.
 */
export function mergeThread<T extends ThreadMessage>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const counts = new Map<string, number>();
  for (const m of incoming) {
    const k = threadKey(m);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const countIn = (arr: T[], k: string) =>
    arr.reduce((n, m) => n + (threadKey(m) === k ? 1 : 0), 0);
  const result = [...prev];
  for (const m of incoming) {
    const k = threadKey(m);
    if (countIn(result, k) < (counts.get(k) ?? 0)) result.push(m);
  }
  return result;
}

/** Index of the newest reset marker; -1 when the thread has none. Assumes sorted input. */
export function lastResetIndex<T extends { role: string }>(msgs: T[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "system") return i;
  }
  return -1;
}

/**
 * The messages the user should actually see. Slices from the newest reset
 * marker (so a new conversation hides everything before it, across reloads and
 * devices), then drops the seed greeting once the user has said anything —
 * preventing it from floating above the first request.
 * Assumes sorted input.
 */
export function visibleThread<T extends ThreadMessage>(msgs: T[]): T[] {
  const idx = lastResetIndex(msgs);
  const sliced = idx >= 0 ? msgs.slice(idx) : msgs;
  if (sliced.some((m) => m.role === "user")) {
    return sliced.filter((m) => m.id !== SEED_GREETING_ID);
  }
  return sliced;
}
