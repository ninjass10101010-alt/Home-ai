/**
 * Subject keys — the stable identity of a fact.
 *
 * A subject is what makes "the family said this again" REPLACE the old text
 * instead of forking a second row. A key derived from the wording alone
 * ("bailey_is_allergic_to_peanuts") is a NEW subject for every rewording,
 * which is how the live bank ended up holding four rows for one emoji rule.
 *
 * Two rules, and both matter:
 *
 * 1. The key is built from the CATEGORY + TOPIC (+ person). The topic is what
 *    the fact is ABOUT ("peanuts"), not how it was phrased. When the caller
 *    knows no topic, the content's own words stand in — the key is then only
 *    deterministic, and `findReplacementSubject` is what makes a rewording
 *    land on the SAME subject.
 * 2. A near-duplicate is detected by TOKEN CONTAINMENT, not by string
 *    equality, so "Bailey cannot eat peanuts" is recognised as the same fact
 *    as "Bailey is allergic to peanuts".
 *
 * The key is a MACHINE identity, so it is ASCII: the shared fold (the
 * retrieval engine's `foldAccents`) runs first, which is why "Begoña"
 * becomes "begona" and not "bego_a". The family's TEXT is never touched by
 * this module — only the key is.
 */

import { foldAccents, tokenize } from './memory-search';

/** The longest a subject key may be. A key is an index value and a filter
 *  term, not a sentence. */
const MAX_KEY = 50;
/** The longest the category part may be. */
const MAX_CATEGORY = 24;
/** The longest the person part may be. */
const MAX_PERSON = 20;
/** The longest the topic part may be, counting the category that precedes
 *  it — "note_the_wifi_code_is_in_the" is the shape this buys. */
const MAX_TOPIC_BLOCK = 28;

/**
 * Lowercase, fold, and turn everything that is not [a-z0-9] into an
 * underscore. The fold runs FIRST so an accented name stays one word
 * ("Begoña" → "begona"); without it the accent would become a separator and
 * the name would be cut in half.
 */
export function slugify(value: string, max = MAX_KEY): string {
  const folded = foldAccents(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return folded.slice(0, Math.max(0, max)).replace(/_+$/g, '');
}

/** The person's own words, folded — so the content fallback can drop them
 *  and the key does not say "Bailey" twice. */
function personWords(person: string): Set<string> {
  return new Set(
    slugify(person, MAX_PERSON)
      .split('_')
      .filter(Boolean),
  );
}

/**
 * `allergy` + topic "peanuts" + person "Emily" → "allergy_peanuts_emily".
 * Without a topic the content's leading words stand in — with the person's
 * name removed, because the name is already the key's suffix.
 */
export function subjectKey(input: {
  category: string;
  person?: string;
  topic?: string;
  content?: string;
}): string {
  const category = slugify(input.category, MAX_CATEGORY) || 'note';
  const person = input.person ? slugify(input.person, MAX_PERSON) : '';
  // The topic shares the key's 50 characters with the category and the
  // person, so it gets whatever is left (and never more than its own block).
  const topicBudget = Math.max(
    4,
    Math.min(
      MAX_TOPIC_BLOCK - category.length - 1,
      MAX_KEY - category.length - (person ? person.length + 1 : 0) - 1,
    ),
  );
  const topic = input.topic
    ? slugify(input.topic, topicBudget)
    : slugify(stripPerson(input.content ?? '', person), topicBudget);
  const key = person ? `${category}_${topic}_${person}` : `${category}_${topic}`;
  return key.slice(0, MAX_KEY).replace(/_+$/g, '') || 'note_general';
}

/** The content without the person's own words. The name is the key's
 *  suffix; repeating it inside the topic makes the key unreadable and eats
 *  the budget the topic needs. */
function stripPerson(content: string, person: string): string {
  if (!person) return String(content ?? '');
  const owned = personWords(person);
  return String(content ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !owned.has(foldAccents(word.toLowerCase())))
    .join(' ');
}

/** The token set of a text: folded, de-duplicated, stop-words dropped. One
 *  word is one token even when it travels in two forms (the folded skeleton
 *  and the raw accented word), so a restatement is not inflated by an
 *  accent. */
function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of tokenize(text, { max: 40 })) {
    const folded = foldAccents(token).toLowerCase();
    if (folded) out.add(folded);
  }
  return out;
}

/** |A ∩ B| / min(|A|, |B|) over content tokens. 1 = identical, 0 = unrelated.
 *  Containment (not Jaccard) so a longer rephrasing still matches the
 *  shorter original — the longer text is the one carrying the new words. */
export function containment(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * The existing subject this content restates, or null. Containment (not
 * Jaccard) so a longer rephrasing still matches the shorter original.
 */
export function findReplacementSubject(
  candidates: Array<{ key: string; content: string }>,
  content: string,
  threshold = 0.6,
): string | null {
  let best: { key: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = containment(candidate.content, content);
    if (score < threshold) continue;
    if (!best || score > best.score) best = { key: candidate.key, score };
  }
  return best?.key ?? null;
}
