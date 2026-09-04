// Pure dedup identity for proactive suggestions. Kept dependency-free so it is
// unit-testable without a PocketBase connection.
//
// For kinds whose title embeds a VOLATILE COUNT (the count changes between
// scans for the same underlying condition), digits are normalized out so
// "2 items have no store assigned" and "3 items…" collapse to one row instead
// of stacking contradictory suggestions. Digit-stripping is deliberately NOT
// applied to kinds whose title carries a distinguishing name (pantry_low
// "Vitamin B12", calendar_conflict "Chapter 1 vs Chapter 2") — stripping there
// would wrongly merge two genuinely different conditions.
const VOLATILE_COUNT_KINDS = new Set(["grocery_store_optimization", "task_penalty_streak"]);

export function conditionKey(kind?: string, title?: string): string {
  let t = (title ?? "").trim().toLowerCase();
  if (kind && VOLATILE_COUNT_KINDS.has(kind)) t = t.replace(/\d+/g, "#");
  return `${kind ?? ""}|${t}`;
}
