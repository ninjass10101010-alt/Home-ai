// Shared bearer-token gate for host-crontab routes (POST /api/cron/**).
//
// Fails closed: when CRON_SECRET is unset, NOTHING authenticates — not even
// the literal string "Bearer undefined" that a naive template comparison
// would accept. Every cron route must use this helper instead of comparing
// against `Bearer ${process.env.CRON_SECRET}` inline.
//
// This is the credential on every cron route, and cron routes move family data
// (Google calendar writes, Telegram polling, HA state, the briefing, suggestions,
// capsule unlocks), so the comparison is timing-safe in the same sense as the
// emergency route's PIN check — the idiom AGENTS.md credits as "fail-closed,
// timing-safe": hash BOTH sides first so the comparison always runs over
// equal-length buffers, then compare the digests. `timingSafeEqual` THROWS on a
// length mismatch, so a guard that hashed only the presented header would turn a
// wrong bearer into a 500 instead of a 401 — and would leak the secret's length
// through the throw.
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const presented = request.headers.get("authorization");
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(`Bearer ${secret}`));
}
