// AI Health — in-memory ring buffer of recent /api/hermes/chat outcomes so an
// admin can answer "was that an LLM timeout, step exhaustion, or the client
// going away?" from Settings without grepping container logs.
// PRIVACY CONTRACT: entries are metadata ONLY (outcome, rounds, duration,
// brain target, failure class) — never message content.
// Volatility note: module-scope state resets on container restart; docker logs
// are the durable record. This panel answers "what just happened?".

export type ChatOutcome =
  | "ok" // answered within the tool rounds
  | "wrapup" // answered only via the forced tool-free final round
  | "exhausted" // even the wrap-up failed → the "ran out of steps" fallback
  | "snag" // every target failed mid-run (timeout / HTTP error)
  | "client_gone" // the requester's connection dropped before we finished
  | "unconfigured"; // no provider chain resolved at all

export interface ChatOutcomeRecord {
  ts: number; // epoch ms
  outcome: ChatOutcome;
  agent: string; // consuela | clem | planner
  rounds: number; // LLM rounds used (the wrap-up round counts)
  ms: number; // total request wall time
  brain: string | null; // "provider/model" of the chain head
  targets: number; // chain length
  reason?: string; // short failure class ("TimeoutError", "HTTP 500") — never content
}

export interface ChatOutcomeSummary {
  total: number;
  ok: number;
  wrapup: number;
  exhausted: number;
  snag: number;
  clientGone: number;
  unconfigured: number;
  avgMs: number;
  lastFailure: ChatOutcomeRecord | null;
}

const MAX_ENTRIES = 50;
const buffer: ChatOutcomeRecord[] = []; // newest-first (record() unshifts)

export function recordChatOutcome(entry: Omit<ChatOutcomeRecord, "ts"> & { ts?: number }): void {
  buffer.unshift({ ...entry, ts: entry.ts ?? Date.now() });
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

export function getRecentOutcomes(limit = MAX_ENTRIES): ChatOutcomeRecord[] {
  return buffer.slice(0, Math.max(0, limit));
}

export function summarizeOutcomes(): ChatOutcomeSummary {
  const s: ChatOutcomeSummary = {
    total: buffer.length,
    ok: 0,
    wrapup: 0,
    exhausted: 0,
    snag: 0,
    clientGone: 0,
    unconfigured: 0,
    avgMs: 0,
    lastFailure: null,
  };
  let msSum = 0;
  for (const rec of buffer) {
    msSum += rec.ms;
    if (rec.outcome === "ok") s.ok++;
    else if (rec.outcome === "wrapup") s.wrapup++;
    else if (rec.outcome === "exhausted") s.exhausted++;
    else if (rec.outcome === "snag") s.snag++;
    else if (rec.outcome === "client_gone") s.clientGone++;
    else if (rec.outcome === "unconfigured") s.unconfigured++;
    if (!s.lastFailure && rec.outcome !== "ok" && rec.outcome !== "wrapup" && rec.outcome !== "unconfigured") {
      s.lastFailure = rec; // buffer is newest-first → first failure met IS the latest
    }
  }
  s.avgMs = buffer.length ? Math.round(msSum / buffer.length) : 0;
  return s;
}

/** Test-only seam (vitest isolation between files doesn't share module state). */
export function clearChatOutcomesForTests(): void {
  buffer.length = 0;
}
