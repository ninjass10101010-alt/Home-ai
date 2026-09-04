// Which proactive suggestions a given role should see. Kitchen/grocery ops are
// the parents' domain — these kinds are hidden from child sessions (their act
// and dismiss actions require a parent PIN anyway, so the rows are pure noise
// to a kid). Shared by the Home widget and the /suggestions page so the two
// never disagree.
export const PARENT_ONLY_SUGGESTION_KINDS: ReadonlySet<string> = new Set([
  "grocery_store_optimization",
  "pantry_low",
]);

export function visibleSuggestionsForRole<T extends { kind: string }>(
  items: T[],
  role?: string
): T[] {
  return role === "child"
    ? items.filter((s) => !PARENT_ONLY_SUGGESTION_KINDS.has(s.kind))
    : items;
}
