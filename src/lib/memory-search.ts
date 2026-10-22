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
 * ACCENT CONTRACT: a PocketBase `~` is a byte-wise `LIKE` — it folds ASCII
 * case and NOTHING else, so it can never fold an accent. A word therefore
 * travels in TWO forms (THREE when its accented letter is capital) and the
 * filter carries ALL of them: the folded ASCII skeleton ("Begoña" →
 * "begona") reaches a row stored folded, and the raw accented word
 * ("begoña") reaches a row stored with its accent. Every comparison this
 * module owns folds both sides, and every match weighs at least 1 while
 * every bonus weighs at least 0, so a fetched fact ALWAYS scores above zero
 * for the word that fetched it — a junk `confidence` can never subtract from
 * the evidence that fetched the row.
 *
 * THE ONE EXCEPTION, stated exactly: a row stored ALL-CAPS WITH ITS ACCENT
 * ("BEGOÑA LOVES TACOS") is reached only by a query typed in that case,
 * because a LIKE folds ASCII case and nothing else. The guarantee is
 * therefore "the row is found whether it is stored folded or accented IN THE
 * CASE THE NAME WAS TYPED IN" — and the write-side fold (the store task)
 * closes the exception for good.
 *
 * The WRITE side should still fold: the store owns what it persists, and a
 * folded row then matches the folded form of every name. Folding on write
 * belongs to the store task — reachability here does not depend on it, apart
 * from the all-caps row named above.
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

const DEFAULT_MAX_WORDS = 12;

/** Letters Unicode cannot decompose, so NFKD leaves them alone: ø ł đ ð þ æ œ ß.
 *  Mapped to their ASCII forms so a name survives tokenising whole — without
 *  the map "Søren" split into the fragment "ren" and "Đorđe" vanished. */
const UNDECOMPOSABLE_LETTERS: Readonly<Record<string, string>> = {
  "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "æ": "ae", "œ": "oe", "ß": "ss",
};

/** A word is a run of letters or digits in ANY script. Splitting on this
 *  keeps "Begoña" one word (so its accent can be seen) instead of cutting it
 *  into an ASCII run plus a fragment. */
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** An ASCII-only token: the shape a folded word must have to be usable as a
 *  filter term. */
const ASCII_TOKEN = /^[a-z0-9]+$/;

/** Fold accents so an accented word stays ONE token. NFKD splits "ñ" into
 *  "n" plus a combining mark; dropping the mark leaves "begona" — one word,
 *  not the "bego" plus a two-letter fragment the old split produced. A
 *  fragment like "oz" is a LIKE pattern wide enough to match "frozen".
 *  The input arrives lowercased (every caller lowercases first), so the
 *  letter map below is written in lowercase. */
function foldAccents(value: string): string {
  return String(value ?? "")
    .replace(/[øłđðþæœß]/g, (ch) => UNDECOMPOSABLE_LETTERS[ch] ?? ch)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

/** Does the word carry a letter outside ASCII? Such a word needs its RAW form
 *  in the filter, because a byte-wise LIKE cannot fold it. */
function hasNonAsciiLetter(word: string): boolean {
  for (const ch of word) {
    if ((ch.codePointAt(0) ?? 0) > 127 && /\p{L}/u.test(ch)) return true;
  }
  return false;
}

/** Does the word carry a CAPITAL letter outside ASCII? SQLite folds ASCII case
 *  only, so the original case is the only form that reaches a stored "Éloise". */
function hasUpperNonAsciiLetter(word: string): boolean {
  for (const ch of word) {
    if ((ch.codePointAt(0) ?? 0) > 127 && /\p{Lu}/u.test(ch)) return true;
  }
  return false;
}

/** The terms one word contributes: the folded skeleton plus the raw word when
 *  the word carries a non-ASCII letter, so the filter reaches a row stored
 *  with the accent AND a row stored folded. The raw form is always the WHOLE
 *  word — never a fragment of it. */
function wordForms(word: string): { skeleton: string; forms: string[] } {
  const lower = word.toLowerCase();
  const skeleton = foldAccents(lower);
  const forms: string[] = [];
  if (ASCII_TOKEN.test(skeleton)) forms.push(skeleton);
  if (hasNonAsciiLetter(word)) {
    forms.push(lower);
    if (hasUpperNonAsciiLetter(word)) forms.push(word);
  }
  return { skeleton, forms };
}

/** Split into words, drop stop-words and 1-char tokens, dedupe, cap.
 *
 *  The cap counts WORDS, not terms: an accented word travels in up to three
 *  forms, so a cap counted in terms was spent after five accented words and
 *  the rest of the message never reached the filter. A word's forms follow
 *  the word, and a word that adds no new form (a repeat) costs no slot. */
export function tokenize(text: string, opts?: { max?: number }): string[] {
  const max = Math.floor(opts?.max ?? DEFAULT_MAX_WORDS);
  if (!Number.isFinite(max) || max <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let words = 0;
  for (const word of String(text ?? "").split(WORD_SPLIT)) {
    if (!word) continue;
    const { skeleton, forms } = wordForms(word);
    if (MEMORY_STOP_WORDS.has(skeleton)) continue;
    let added = 0;
    for (const form of forms) {
      if (form.length < 2) continue;
      if (seen.has(form)) continue;
      seen.add(form);
      out.push(form);
      added += 1;
    }
    // A repeat adds no new form, so it costs no word of the cap either.
    if (added > 0) {
      words += 1;
      if (words >= max) break;
    }
  }
  return out;
}

/** PocketBase 0.40.5's own filter limits, measured on a real PocketBase with
 *  the real `consuela_family_memories` schema: a filter may carry at most
 *  200 conditions and at most 3,500 bytes. One byte more, or one condition
 *  more, and the filter is REJECTED with a 400 — which the caller swallows,
 *  so the memory silently disappears. */
const MAX_FILTER_BYTES = 3500;
const MAX_FILTER_CONDITIONS = 200;

/** The longest escaped term that reaches a filter. A term is a WORD of the
 *  user's message, so 64 characters is far more than any real one — but a
 *  pasted blob (or a CJK run with no spaces) is not, and an uncapped term
 *  would build a filter PocketBase rejects. */
const MAX_FILTER_TERM_CHARS = 64;

/**
 * Make a value safe to interpolate into a PocketBase filter string.
 * A raw `"` produces an invalid filter (PB 400 → the catch swallows it →
 * memory silently disappears); `%` and `_` are LIKE wildcards; `\` is PB's
 * escape character.
 *
 * A NUL byte (and the other control characters) makes PocketBase reject the
 * WHOLE filter, so they are stripped here rather than escaped — a control
 * character carries no meaning in a name, and a filter that cannot run is
 * worse than a filter that matches a little less.
 */
export function escapeFilterValue(value: string): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\\/g, " ")
    .replace(/"/g, "'")
    .replace(/%/g, " per cent")
    .replace(/_/g, " ")
    .trim()
    .slice(0, MAX_FILTER_TERM_CHARS)
    .trim();
}

/**
 * One OR across content, tags and key. A single-token LIKE per term is the
 * only shape PocketBase can express, and it is what makes a multi-word
 * question find a memory at all.
 *
 * The filter stays inside PocketBase's measured limits (200 conditions,
 * 3,500 bytes): the tail is dropped rather than handing PocketBase a filter
 * it would reject, because a rejected filter is a 400 and a 400 is a memory
 * that silently disappears. The HEAD survives, and the head is the part that
 * matters — the first term is the first `content ~` clause a caller reads.
 */
export function buildMemoryFilter(terms: string[]): string {
  let filter = "";
  let conditions = 0;
  for (const term of terms) {
    const safe = escapeFilterValue(term);
    if (!safe) continue;
    const clause = `content ~ "${safe}" || tags ~ "${safe}" || key ~ "${safe}"`;
    const next = filter ? `${filter} || ${clause}` : clause;
    if (conditions + 3 > MAX_FILTER_CONDITIONS) break;
    if (next.length + 2 > MAX_FILTER_BYTES) break;
    filter = next;
    conditions += 3;
  }
  return filter ? `(${filter})` : "";
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

/** Is the fact's person the speaker? The match is on WHOLE WORDS: "Ann" is
 *  not inside "Joanne", so a fact about a different person never inherits
 *  the speaker's +2. Both names arrive folded and lowercased. */
function isSamePerson(person: string, speaker: string): boolean {
  const who = person.trim();
  const talking = speaker.trim();
  if (!who || !talking) return false;
  if (who === talking) return true;
  return who.split(/\s+/).includes(talking);
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
  // A word arrives in two forms (folded + raw). It is ONE word, so it is ONE
  // hit: without this an accented name would out-score a plain one purely by
  // travelling twice. Folding maps a substring to a substring, so the folded
  // comparison already covers the raw form — no second check is needed.
  const counted = new Set<string>();
  for (const rawTerm of terms) {
    const term = foldAccents(String(rawTerm ?? "").toLowerCase());
    // An empty term is a substring of every string, so it would score the
    // whole bank — while `buildMemoryFilter` builds nothing for it. The two
    // entry points must agree: an empty term matches nothing.
    if (!term) continue;
    if (counted.has(term)) continue;
    counted.add(term);
    if (content.includes(term)) score += 1;
    if (tagText.some((t) => t.includes(term))) score += 1.2;
    // The person match stays a SUBSTRING, unlike the speaker bonus below: the
    // filter's `~` is a substring match too, so a fact the filter fetched
    // through a person's name must score here as well. Making it a
    // word-boundary match would re-create the "fetched, scored zero,
    // forgotten" shape this module exists to prevent.
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
  if (isSamePerson(person, speaker)) score += 2;
  if (SAFETY_CATEGORIES.has(String(mem.category))) score += 1.5;
  // A junk confidence must never subtract from the evidence that fetched the
  // row: `confidence` is writable UNVALIDATED (the family-memory route reads
  // it straight from the request body), so a negative value is reachable in
  // production, and the caller's `score > 0` filter would then drop a fact
  // the filter had just fetched. Clamped at zero, a junk confidence is
  // NEUTRAL — never a penalty that cancels the match.
  score += Math.max(0, finiteNumber(mem.confidence));
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
 *
 * The budget is always a finite number. A budget that is not one (NaN,
 * undefined, Infinity) is treated as ZERO — a hard, small limit — because a
 * junk budget must never mean "no limit" for the always-injected core.
 */
export function selectCoreFacts<T extends MemoryLike>(
  mems: T[],
  opts: { budget: number; speakerName?: string; now?: number },
): T[] {
  // A budget is always a FINITE number. `Math.max(0, NaN)` is NaN, and every
  // comparison against NaN is false — so a junk budget silently kept every
  // fact and the always-injected core grew without bound. A junk budget is a
  // hard, small limit instead: zero discretionary facts.
  const budget = Number.isFinite(opts.budget) ? Math.max(0, opts.budget) : 0;
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
      // A word arrives in two forms (folded + raw): one word, one hit.
      const counted = new Set<string>();
      for (const term of terms) {
        const needle = foldAccents(String(term ?? "").toLowerCase());
        if (!needle) continue;
        if (counted.has(needle)) continue;
        counted.add(needle);
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
