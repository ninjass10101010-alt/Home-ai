import { createHash } from "node:crypto";
import type { SuggestionKind } from "./types";
export function idempotencyHashOf(kind: SuggestionKind, title: string, scopeDate: string): string {
  const norm = `${kind}|${title.trim().toLowerCase()}|${scopeDate}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}
