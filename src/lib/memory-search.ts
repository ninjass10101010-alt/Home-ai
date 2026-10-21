/**
 * Pure retrieval for the family memory bank.
 *
 * WHY THIS EXISTS: PocketBase's `~` operator is a VERBATIM `LIKE '%value%'`
 * — it does not tokenise, stem or match words. The old code filtered on the
 * entire user message, so the filter could never match a memory row and the
 * memory block never reached the system prompt (proved on the live database:
 * the old filter returned 0 of 11 rows; a token OR returned 6).
 *
 * Everything here is pure and deterministic so it can be unit-tested without
 * PocketBase, and so the filter it builds can be asserted byte-for-byte.
 */

export interface MemoryLike {
  id: string;
  category?: string;
  key?: string;
  content?: string;
  tags?: string[] | string;
  person?: string;
  confidence?: number;
  usageCount?: number;
  updatedAt?: string;
}

/** Words that carry no retrieval signal. Kept short on purpose: a fact can be
 *  about "the", and over-pruning loses real matches. */
export const MEMORY_STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "been", "but", "by", "can", "could", "did", "do", "does", "doing", "done",
  "for", "from", "get", "got", "had", "has", "have", "he", "her", "him", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "like", "me", "my",
  "no", "not", "of", "on", "or", "our", "out", "over", "she", "should", "so",
  "some", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "to", "too", "up", "us", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

const DEFAULT_MAX_TERMS = 12;

/** Lowercase, split on anything that is not a letter or digit, drop stop-words
 *  and 1-char tokens, dedupe, cap. */
export function tokenize(text: string, opts?: { max?: number }): string[] {
  const max = Math.floor(opts?.max ?? DEFAULT_MAX_TERMS);
  if (!Number.isFinite(max) || max <= 0) return [];
  const raw = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) continue;
    if (MEMORY_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Make a value safe to interpolate into a PocketBase filter string.
 * A raw `"` produces an invalid filter (PB 400 → the catch swallows it →
 * memory silently disappears); `%` and `_` are LIKE wildcards; `\` is PB's
 * escape character.
 */
export function escapeFilterValue(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, " ")
    .replace(/"/g, "'")
    .replace(/%/g, " per cent")
    .replace(/_/g, " ")
    .trim();
}

/**
 * One OR across content, tags and key. A single-token LIKE per term is the
 * only shape PocketBase can express, and it is what makes a multi-word
 * question find a memory at all.
 */
export function buildMemoryFilter(terms: string[]): string {
  const parts: string[] = [];
  for (const term of terms) {
    const safe = escapeFilterValue(term);
    if (!safe) continue;
    parts.push(`content ~ "${safe}"`);
    parts.push(`tags ~ "${safe}"`);
    parts.push(`key ~ "${safe}"`);
  }
  return parts.length ? `(${parts.join(" || ")})` : "";
}

/** The store writes tags as a JSON string; PB `json` fields return arrays. */
export function parseTagList(tags: string[] | string | undefined): string[] {
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
  if (typeof tags !== "string" || !tags.trim()) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const SAFETY_CATEGORIES = new Set(["allergy", "restriction"]);

/** Weighted relevance. Person/tag hits beat content hits; safety facts beat
 *  notes; confidence, usage and recency break the remaining ties. */
export function scoreMemory(
  mem: MemoryLike,
  terms: string[],
  ctx?: { now?: number; speakerName?: string },
): number {
  if (!terms.length) return 0;
  const content = String(mem.content ?? "").toLowerCase();
  const tagText = parseTagList(mem.tags).map((t) => t.toLowerCase());
  const person = String(mem.person ?? "").toLowerCase();
  const speaker = String(ctx?.speakerName ?? "").toLowerCase();

  let score = 0;
  for (const rawTerm of terms) {
    const term = rawTerm.toLowerCase();
    if (content.includes(term)) score += 1;
    if (tagText.some((t) => t.includes(term))) score += 1.2;
    if (person && person.includes(term)) score += 1.2;
  }
  // Nothing matched: this fact is not about the message, whatever else it is.
  if (!score) return 0;
  // The speaker bonus belongs to the FACT (its person is the one being asked
  // about), not to the query — it is added once, so the same fact scores the
  // same however many terms happened to match it.
  if (speaker && person && (person === speaker || person.includes(speaker))) score += 2;
  if (SAFETY_CATEGORIES.has(String(mem.category))) score += 1.5;
  score += Number(mem.confidence ?? 0);
  score += Math.log10(1 + Number(mem.usageCount ?? 0)) * 0.25;
  const updated = mem.updatedAt ? Date.parse(mem.updatedAt) : NaN;
  if (!Number.isNaN(updated) && ctx?.now !== undefined) {
    const days = Math.max(0, (ctx.now - updated) / 86_400_000);
    score += Math.max(0, 0.5 - days / 365);
  }
  return score;
}

/**
 * Durable ranking — which facts deserve a place in the always-injected core
 * when NO message is in play. Term relevance is a different question (see
 * `scoreMemory`), so the two never share a score: a durable ranking that
 * scored on terms would collapse to zero for every fact and the order would
 * be whatever the caller happened to pass in.
 */
export function rankFacts<T extends MemoryLike>(mems: T[], ctx?: { now?: number }): T[] {
  const now = ctx?.now ?? Date.now();
  const weight = (mem: T): number => {
    let score = Number(mem.confidence ?? 0);
    score += Math.log10(1 + Number(mem.usageCount ?? 0)) * 0.5;
    const updated = mem.updatedAt ? Date.parse(mem.updatedAt) : NaN;
    if (!Number.isNaN(updated)) score += Math.max(0, 0.5 - (now - updated) / 86_400_000 / 365);
    return score;
  };
  return [...mems].sort((a, b) => weight(b) - weight(a));
}

/**
 * The always-injected set: every safety fact, then the best of the rest,
 * until the character budget is spent. A fact that does not fit is dropped,
 * never truncated. Each fact costs its text plus a small per-line allowance.
 *
 * A SAFETY fact is always kept, even when it alone busts the budget — a
 * child's allergy must never be the thing that gets dropped. The budget
 * governs the discretionary facts.
 *
 * `speakerName` is accepted so call sites can pass it, but it is NOT a
 * privacy control: scoping the set to one speaker is the caller's job (a
 * child must never be handed a sibling's fact).
 */
export function selectCoreFacts<T extends MemoryLike>(
  mems: T[],
  opts: { budget: number; speakerName?: string; now?: number },
): T[] {
  const budget = Math.max(0, opts.budget);
  const safety = mems.filter((m) => SAFETY_CATEGORIES.has(String(m.category)));
  const rest = mems.filter((m) => !SAFETY_CATEGORIES.has(String(m.category)));
  const chosen: T[] = [];
  let used = 0;
  for (const mem of safety) {
    chosen.push(mem);
    used += (mem.content?.length ?? 0) + 8;
  }
  for (const mem of rankFacts(rest, { now: opts.now })) {
    const size = (mem.content?.length ?? 0) + 8;
    if (used + size > budget) continue;
    chosen.push(mem);
    used += size;
  }
  return chosen;
}

/** Episodic search over chat turns. App-side on purpose: a PocketBase FTS5
 *  virtual table would be a schema PB does not own. */
export function searchMessages<T extends { content?: string; role?: string; createdAt?: string }>(
  rows: T[],
  terms: string[],
  limit = 10,
): T[] {
  if (!terms.length) return [];
  const scored = rows
    .map((row) => {
      const content = String(row.content ?? "").toLowerCase();
      let hits = 0;
      for (const term of terms) if (content.includes(term.toLowerCase())) hits += 1;
      return { row, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || String(a.row.createdAt ?? "").localeCompare(String(b.row.createdAt ?? "")));
  return scored.slice(0, limit).map((entry) => entry.row);
}
