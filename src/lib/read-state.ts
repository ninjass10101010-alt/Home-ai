/**
 * read-state.ts — one honest vocabulary for "why is this data not here?"
 *
 * Audit P0-4 (`docs/UI_AUDIT_2026-09.md`): before this module the app had two
 * answers to a failed read — an empty array or a spinner that never stops — so
 * *offline*, *signed out*, *genuinely empty* and *broken* were
 * indistinguishable on a wall display. A network hiccup on the family calendar
 * rendered as "Quiet day", which is the single most misleading thing a
 * calendar/chore screen can do.
 *
 * This file is deliberately React-free (and therefore trivially unit-testable)
 * so every layer — hooks, the `db` read helpers, a widget's own `.catch` — can
 * classify a failure the same way and reuse the same human copy.
 *
 * Existing house copy this aligns with: `SyncStatusBanner` ("showing your saved
 * copy… sign in with your PIN"), `meals/PlanTab` blocked card, and Home's
 * "Google Calendar is unavailable — showing saved events." pill.
 */

/** Every state a read can be in. `loading` / `ready` are healthy; the rest are *failures to explain*. */
export type SafeState = "loading" | "ready" | "empty" | "offline" | "unauthorised" | "error";

/** The states that mean "the data you're looking at is not the family truth". */
export type ReadFailure = Exclude<SafeState, "loading" | "ready">;

/**
 * Human copy per failure state. Kept here (not in components) so a widget
 * cannot invent a fourth flavor of "something went wrong". `empty` is included
 * because the *absence* of rows also has to be worded honestly — it is the
 * state families misread most.
 */
export const READ_COPY: Record<ReadFailure, string> = {
  empty: "Nothing here yet.",
  offline: "Offline — showing your saved copy.",
  unauthorised: "Sign in with your PIN to see the family's data.",
  error: "Couldn't load this right now.",
};

/** A read that kept its last good data after a failed refresh. */
export const READ_COPY_STALE = "Showing your saved copy — couldn't refresh.";

/** Default affordance label; matches `ErrorState`'s `retryLabel` default. */
export const READ_RETRY_LABEL = "Try again";

/** A read failure that already knows which state it is (thrown by `assertReadable` and the API helpers). */
export class ReadError extends Error {
  readonly state: ReadFailure;
  readonly status?: number;

  constructor(state: ReadFailure, message: string, status?: number) {
    super(message);
    this.name = "ReadError";
    this.state = state;
    this.status = status;
  }
}

/** True when the browser itself reports no network connection. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && navigator.onLine === false;
}

/**
 * HTTP status → state. `0` is what a fetch that never reached a server looks
 * like (CORS-blocked/offline in some engines), so it counts as offline rather
 * than a server bug. 401/403 are *session* states, not errors: the right ask is
 * "sign in", never "try again".
 */
export function classifyStatus(status: number): ReadFailure {
  if (status === 0) return "offline";
  if (status === 401 || status === 403) return "unauthorised";
  return "error";
}

const NETWORK_COPY = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|net::|connection (refused|reset|closed)/i;

/**
 * The single classifier. Order matters: an explicit `ReadError` wins, then an
 * `AbortError` (a deliberate cancel is not a failure the family should see —
 * callers that abort on unmount should filter before calling), then the
 * transport-level shapes, and only then the browser hint.
 */
export function classifyReadError(err: unknown): ReadFailure {
  if (err instanceof ReadError) return err.state;

  const maybeResponse = err as { status?: unknown } | null;
  if (maybeResponse && typeof maybeResponse.status === "number") {
    return classifyStatus(maybeResponse.status);
  }

  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name?: unknown }).name) : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";

  if (name === "AbortError") return "error";
  // A transport failure is only provably *our* connection when the browser says
  // so. "Failed to fetch" with `onLine: true` normally means the backboard is
  // unreachable, and telling a family they are "offline" in that case is a lie
  // that sends them to the wrong router — so it stays `error`, and callers with
  // data on screen get `READ_COPY_STALE` instead.
  if (NETWORK_COPY.test(message)) {
    return isBrowserOffline() || typeof navigator === "undefined" ? "offline" : "error";
  }
  if (isBrowserOffline()) return "offline";
  return "error";
}

/** Throw a correctly-classified `ReadError` for a non-ok response; pass ok responses through. */
export function assertReadable<T extends { ok: boolean; status: number }>(res: T): T {
  if (!res.ok) {
    const state = classifyStatus(res.status);
    throw new ReadError(state, `read failed: ${res.status}`, res.status);
  }
  return res;
}

/** `ready` when rows exist, `empty` when the read succeeded and there are none. */
export function readStateForRows(rows: readonly unknown[] | null | undefined): "ready" | "empty" {
  return Array.isArray(rows) && rows.length > 0 ? "ready" : "empty";
}

/** `gatewayReadStatus` already distinguishes a BLOCKED read from a genuinely
 *  empty one (`src/db/index.ts`); this maps that pair onto the shared state
 *  vocabulary so the Meals/Recipes path and the hook path agree. */
export function stateForGatewayRead(read: { items: readonly unknown[]; blocked: boolean }): SafeState {
  if (read.blocked) return "unauthorised";
  return readStateForRows(read.items);
}

/** Copy for a failed read, honouring whether usable (possibly stale) data remains on screen. */
export function readMessageFor(state: ReadFailure, hasData: boolean): string {
  if (hasData && (state === "offline" || state === "error")) return READ_COPY_STALE;
  return READ_COPY[state];
}
