import { createHash } from "node:crypto";
import type { SuggestionKind, SuggestionSeverity } from "./types";
// L1 — include severity + action args in the dedup hash: two suggestions with
// the same kind/title/scopeDate but different severity (e.g. "out" vs "running
// low") or different action args are distinct and must both be inserted.
export function idempotencyHashOf(
  kind: SuggestionKind,
  title: string,
  scopeDate: string,
  severity?: SuggestionSeverity,
  actionArgs?: Record<string, unknown>
): string {
  const norm = `${kind}|${title.trim().toLowerCase()}|${scopeDate}|${severity ?? ""}|${JSON.stringify(actionArgs ?? {})}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}
