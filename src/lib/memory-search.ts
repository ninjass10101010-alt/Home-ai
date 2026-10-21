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
 * Nothing reads the clock: recency is applied only when the caller passes a
 * `now`, so the same input always produces the same output.
 *
 * ACCENT CONTRACT: a query is folded to ASCII ("Begoña" → "begona") and every
 * comparison this module owns compares folded text, so the query side and the
 * scoring side agree. A PocketBase `LIKE` cannot fold — the database compares
 * the bytes — so the WRITE side must store the folded form too. A row that
 * keeps its accent is invisible to the filter no matter what this module does
 * (the store's slug and content must be folded on write).
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

/** Fold accents so an accented word stays ONE token. NFKD splits "ñ" into
 *  "n" plus a combining mark; dropping the mark leaves "begona" — one word,
 *  not the "bego" plus a two-letter fragment the old split produced. A
 *  fragment like "oz" is a LIKE pattern wide enough to match "frozen". */
function foldAccents(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

/** Lowercase, fold accents, split on anything that is not a letter or digit,
 *  drop stop-words and 1-char tokens, dedupe, cap. */
export function tokenize(text: string, opts?: { max?: number }): string[] {
  const max = Math.floor(opts?.max ?? DEFAULT_MAX_TERMS);
  if (!Number.isFinite(max) || max <= 0) return [];
  const raw = foldAccents(String(text ?? "").toLowerCase())
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

/** `tags` is a TEXT column, so PocketBase hands back the JSON string the store
 *  wrote. The array branch is defensive (a caller may hand us a parsed list). */
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

/** Coerce a stored number to a finite one. `?? 0` only catches null/undefined,
 *  so a NaN or -Infinity written by a bad row flowed straight into a score:
 *  NaN > 0 is false (the fact was silently dropped by the caller's filter)
 *  and a NaN comparator leaves the sort order at the caller's mercy. */
function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Weighted relevance. Person/tag hits beat content hits; safety facts beat
 *  notes; confidence, usage and (with a clock) recency break the remaining
 *  ties. */
export function scoreMemory(
  mem: MemoryLike,
  terms: string[],
  ctx?: { now?: number; speakerName?: string },
): number {
  if (!terms.length) return 0;
  const content = foldAccents(String(mem.content ?? "").toLowerCase());
  const tagText = parseTagList(mem.tags).map((t) => foldAccents(t.toLowerCase()));
  const person = foldAccents(String(mem.person ?? "").toLowerCase());
  const key = foldAccents(String(mem.key ?? "").toLowerCase());
  const speaker = foldAccents(String(ctx?.speakerName ?? "").toLowerCase());

  let score = 0;
  for (const rawTerm of terms) {
    const term = foldAccents(rawTerm.toLowerCase());
    // An empty term is a substring of every string, so it would score the
    // whole bank — while `buildMemoryFilter` builds nothing for it. The two
    // entry points must agree: an empty term matches nothing.
    if (!term) continue;
    if (content.includes(term)) score += 1;
    if (tagText.some((t) => t.includes(term))) score += 1.2;
    if (person && person.includes(term)) score += 1.2;
    // The key is the subject slug the filter ALSO searches, so a fact whose
    // only hit is in the key is fetched by the filter — if it scored zero here
    // the caller's `score > 0` filter would drop it again and the family
    // would see "no memory" for a fact we just fetched.
    if (key && key.includes(term)) score += 1;
  }
  // Nothing matched: this fact is not about the message, whatever else it is.
  if (!score) return 0;
  // The speaker bonus belongs to the FACT (its person is the one being asked
  // about), not to the query — it is added once, so the same fact scores the
  // same however many terms happened to match it.
  if (speaker && person && (person === speaker || person.includes(speaker))) score += 2;
  if (SAFETY_CATEGORIES.has(String(mem.category))) score += 1.5;
  score += finiteNumber(mem.confidence);
  score += Math.log10(1 + Math.max(0, finiteNumber(mem.usageCount))) * 0.25;
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
 *
 * Recency needs a clock, exactly as in `scoreMemory`: with no `now` the order
 * is confidence + usage alone, so the always-injected core cannot shift
 * because the calendar moved. A caller that wants recency supplies `now`.
 */
export function rankFacts<T extends MemoryLike>(mems: T[], ctx?: { now?: number }): T[] {
  const now = ctx?.now;
  const weight = (mem: T): number => {
    let score = finiteNumber(mem.confidence);
    score += Math.log10(1 + Math.max(0, finiteNumber(mem.usageCount))) * 0.5;
    const updated = mem.updatedAt ? Date.parse(mem.updatedAt) : NaN;
    if (now !== undefined && !Number.isNaN(updated)) {
      const days = Math.max(0, (now - updated) / 86_400_000);
      score += Math.max(0, 0.5 - days / 365);
    }
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
 * child's allergy must never be the thing that gets dropped. Safety facts
 * are therefore NOT charged against the budget: the budget rations the
 * discretionary facts, so an allergy cannot push a preference out of the
 * prompt.
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
  for (const mem of safety) chosen.push(mem);
  let used = 0;
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
      const content = foldAccents(String(row.content ?? "").toLowerCase());
      let hits = 0;
      for (const term of terms) {
        const needle = foldAccents(term.toLowerCase());
        if (!needle) continue;
        if (content.includes(needle)) hits += 1;
      }
      return { row, hits };
    })
    .filter((entry) => entry.hits > 0)
    // Newest first on a tie: the session loader already hands the turns over
    // newest-first, so sorting them oldest-first would answer "did we discuss
    // X?" with the OLDEST conversation and push the recent one off the limit.
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        String(b.row.createdAt ?? "").localeCompare(String(a.row.createdAt ?? "")),
    );
  return scored.slice(0, limit).map((entry) => entry.row);
}
