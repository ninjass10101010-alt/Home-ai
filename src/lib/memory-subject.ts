/**
 * Subject keys — the stable identity of a fact.
 *
 * A subject is what makes "the family said this again" REPLACE the old text
 * instead of forking a second row. A key derived from the wording alone
 * ("bailey_is_allergic_to_peanuts") is a NEW subject for every rewording,
 * which is how the live bank ended up holding four rows for one emoji rule.
 *
 * THE SUBJECT IS CATEGORY + TOPIC (+ PERSON), NEVER A CONTENT OVERLAP.
 *
 * An earlier version decided "is this the same fact?" by counting the shared
 * tokens of the two sentences. The PERSON'S NAME is one of those tokens, so
 * "Bailey is allergic to peanuts" and "Bailey is allergic to shellfish" scored
 * as near-identical and collapsed into ONE row — the peanut allergy was
 * destroyed, surviving only in a `history` nobody reads. That is a worse bug
 * than the fork it was meant to cure: a fork shows the family two rows, a
 * collapse silently loses an allergy.
 *
 * So the comparison is made on the TOPIC — the informative words of the
 * sentence with the person, the relation and the category's own words
 * removed:
 *
 *   "Bailey is allergic to peanuts"        → topic {peanuts}
 *   "Bailey cannot eat peanuts"            → topic {peanuts}   (a rewording)
 *   "Bailey is allergic to shellfish"      → topic {shellfish} (a DIFFERENT fact)
 *   "Bailey loves sushi"                   → topic {sushi}
 *   "Bailey loves pizza"                   → topic {pizza}
 *
 * Two facts are the SAME subject when their topics SHARE an informative word
 * — the object the fact is about. They are never the same subject when the
 * topics are disjoint.
 *
 * The rule is deliberately biased: a subject that cannot be told apart is
 * treated as a DIFFERENT subject and forks a row, because a row the family
 * can see is a nuisance while a silently replaced allergy is a harm.
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
 * Words that carry the RELATION, not the topic: how the family member feels
 * about something, or the grammar holding the sentence together. "is allergic
 * to" and "cannot eat" say the same thing about peanuts; the difference
 * between two facts is the NOUN, never the verb.
 */
const RELATION_WORDS: ReadonlySet<string> = new Set([
  'am', 'are', 'be', 'been', 'being', 'can', 'cannot', 'cant', 'could', 'did',
  'do', 'does', 'doing', 'done', 'had', 'has', 'have', 'having', 'is', 'may',
  'might', 'must', 'shall', 'should', 'was', 'were', 'will', 'would',
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'because', 'as', 'if',
  'then', 'than', 'that', 'this', 'these', 'those', 'there', 'here',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his',
  'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours',
  'they', 'them', 'their', 'theirs', 'who', 'whom', 'whose', 'which', 'what',
  'when', 'where', 'why', 'how', 'not', 'no', 'never', 'always', 'often',
  'usually', 'really', 'very', 'quite', 'just', 'only', 'even', 'still',
  'also', 'too', 'much', 'more', 'most', 'less', 'least', 'prefer', 'prefers',
  'preferred', 'preference', 'like', 'likes', 'liked', 'love', 'loves',
  'loved', 'hate', 'hates', 'hated', 'dislike', 'dislikes', 'want', 'wants',
  'need', 'needs', 'eat', 'eats', 'ate', 'eating', 'drink', 'drinks',
  'play', 'plays', 'playing', 'watch', 'watches', 'allergic', 'allergy',
  'allergies', 'avoid', 'avoids', 'tolerate', 'tolerates', 'favorite',
  'favourite', 'use', 'uses', 'using', 'used', 'keep', 'keeps', 'report',
  'reports', 'call', 'calls', 'named', 'name', 'add', 'adds', 'adding',
  'include', 'includes', 'including', 'put', 'puts', 'make', 'makes', 'made',
  'take', 'takes', 'get', 'gets', 'give', 'gives', 'set', 'sets', 'go', 'goes',
  'come', 'comes', 'live', 'lives', 'work', 'works', 'serve', 'serves',
  'let', 'lets', 'please', 'always', 'never', 'when', 'whenever', 'before',
  'after', 'during', 'instead', 'also', 'mean', 'means', 'like', 'get',
  'start', 'starts', 'started', 'end', 'ends', 'ended', 'ban', 'bans',
  'banned', 'allow', 'allows', 'allowed', 'require', 'requires', 'required',
  'change', 'changes', 'changed', 'move', 'moves', 'moved', 'arrive',
  'arrives', 'begin', 'begins', 'finish', 'finishes', 'attend', 'attends',
  'sit', 'sits', 'stand', 'stands', 'wear', 'wears', 'read', 'reads', 'write',
  'hide', 'hides', 'hidden', 'steal', 'steals', 'lose', 'loses', 'find', 'finds',
  'writes', 'speak', 'speaks', 'sign', 'signs', 'practice', 'practices',
  'practise', 'practises', 'join', 'joins', 'leave', 'leaves', 'stay', 'stays',
]);

/**
 * Words that are too GENERIC to be a topic. "Caspian has practice on
 * Tuesdays" and "Caspian has soccer on Tuesdays" are two different facts
 * that share the word "Tuesdays" — a day is when something happens, not what
 * it is about. The same goes for a month, a clock time and the vague nouns.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays',
  'sundays',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'januaries', 'februaries', 'marches', 'aprils', 'junes', 'julys', 'augusts',
  'septembers', 'octobers', 'novembers', 'decembers',
  'day', 'days', 'week', 'weeks', 'weekend', 'weekends', 'month', 'months',
  'year', 'years', 'morning', 'mornings', 'afternoon', 'afternoons', 'evening',
  'evenings', 'night', 'nights', 'today', 'tomorrow', 'yesterday', 'tonight',
  'time', 'times', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds',
  'home', 'house', 'homes', 'houses', 'school', 'schools', 'family',
  'families', 'thing', 'things', 'stuff', 'one', 'two', 'everyone',
  'everybody', 'someone', 'people', 'daytime', 'lunchtime', 'dinnertime',
  'bedtime',
]);

/**
 * Lowercase, fold, and turn everything that is not [a-z0-9] into an
 * underscore.
 *
 * The lowercasing runs BEFORE the fold on purpose: the fold's letter map
 * (ø ł đ ð þ æ œ ß) is lowercase, so "SØREN" would otherwise fold to "Søren"
 * and then have its Ø dropped as a separator — the name cut in half, which
 * is the exact failure this module exists to prevent.
 */
export function slugify(value: string, max = MAX_KEY): string {
  const folded = foldAccents(String(value ?? '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return folded.slice(0, Math.max(0, max)).replace(/_+$/g, '');
}

/** The person's own words, folded — so the topic can drop them and the key
 *  does not say "Bailey" twice.
 *
 *  The FULL name is used, not the key's truncated form: a name longer than
 *  the key's person budget would otherwise leave its tail in the topic
 *  ("Fitzwilliam" in "Fitzwilliam The Third"), and the topic would then be
 *  about a fragment of the name. */
function personWords(person: string): Set<string> {
  return new Set(
    foldAccents(String(person ?? '').toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
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

/** Every meaningful word of a sentence, in order, folded. */
export function contentTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokenize(text, { max: 40 })) {
    const folded = foldAccents(token).toLowerCase();
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    out.push(folded);
  }
  return out;
}

/**
 * The TOPIC of a sentence: its meaningful words minus the person, minus the
 * relation, minus the category's own words. "Bailey is allergic to peanuts"
 * (allergy, Bailey) → ["peanuts"].
 */
export function topicTokens(
  text: string,
  opts?: { person?: string; category?: string },
): string[] {
  const person = opts?.person ? personWords(opts.person) : new Set<string>();
  const categoryWords = new Set(
    slugify(opts?.category ?? '', MAX_CATEGORY).split('_').filter(Boolean),
  );
  const meaningful = contentTokens(text).filter(
    (token) => !person.has(token) && !categoryWords.has(token) && !GENERIC_WORDS.has(token),
  );
  const topic = meaningful.filter((token) => !RELATION_WORDS.has(token));
  if (topic.length) return topic;
  // Nothing survived the relation words — the sentence is built entirely out
  // of them ("Emily's school starts at 8"). Those relations ARE the fact
  // here, so the topic falls back to the meaningful words rather than
  // becoming empty: an empty topic matches nothing, and a fact that can
  // never be recognised is a fact that forks on every correction.
  return meaningful;
}

/**
 * `allergy` + topic "peanuts" + person "Emily" → "allergy_peanuts_emily".
 * Without a topic the content's TOPIC stands in — the informative words, so
 * a rewording of the same fact produces the SAME key.
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
    : slugify(
        topicTokens(input.content ?? '', { person: input.person, category: input.category }).join(' '),
        topicBudget,
      );
  const key = person ? `${category}_${topic}_${person}` : `${category}_${topic}`;
  return key.slice(0, MAX_KEY).replace(/_+$/g, '') || 'note_general';
}

/**
 * |A ∩ B| / min(|A|, |B|) over content tokens: 1 when the shorter text's
 * words are all in the longer one, 0 when they share nothing. It is a
 * SIMILARITY RATIO, not an identity — two sentences about the same person
 * share that person's name, so a high ratio says very little about whether
 * they are the same fact. Deciding whether two facts are the same subject is
 * `sameTopic` below, which compares the topics themselves.
 */
export function containment(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Are these two sentences about the SAME subject? They must SHARE at least
 * one informative word — the topic of the fact, with the person, the relation
 * and the generic words removed.
 *
 * Sharing is the rule, and it is what separates the two cases that matter:
 *   "allergic to peanuts" vs "allergic to shellfish" → no shared informative
 *     word (peanuts vs shellfish) → DIFFERENT subjects. This is the rule
 *     that stops two allergies from collapsing into one row.
 *   "is allergic to peanuts" vs "cannot eat peanuts" → share "peanuts" →
 *     the SAME subject. This is the rule that makes a rewording replace.
 *
 * The relation words and the generic words (a day, a month, "home") are what
 * keep the second rule from being too eager: "Caspian has practice on
 * Tuesdays" and "Caspian has soccer on Tuesdays" share only the day, which
 * is not a topic, so they stay two facts.
 *
 * An EMPTY topic matches nothing: a sentence with no informative words
 * ("Bailey") is not a fact about every topic that person has.
 */
export function sameTopic(
  a: string,
  b: string,
  opts?: { person?: string; category?: string },
): boolean {
  const left = new Set(topicTokens(a, opts));
  const right = new Set(topicTokens(b, opts));
  if (!left.size || !right.size) return false;
  for (const token of left) if (right.has(token)) return true;
  return false;
}

/**
 * Does the NEW text say LESS than the text already stored? A merge must
 * never degrade a fact: storing the bare word "peanuts" must not replace
 * "Bailey is allergic to peanuts", because the new text is a strict subset of
 * the stored one in meaningful words.
 */
export function isLessInformative(newText: string, storedText: string): boolean {
  const next = new Set(contentTokens(newText));
  const stored = new Set(contentTokens(storedText));
  if (!next.size) return true;
  if (!stored.size) return false;
  for (const token of next) if (!stored.has(token)) return false;
  // A strict subset is a loss; an equal set is a rewording.
  return next.size < stored.size;
}

/**
 * The existing subject this content restates, or null. The match is by
 * TOPIC, never by content overlap: a candidate whose topic differs is never
 * returned, so two different facts can never collapse into one row.
 */
export function findReplacementSubject(
  candidates: Array<{ key: string; content: string }>,
  content: string,
  opts?: { category?: string; person?: string },
): string | null {
  const category = opts?.category;
  const person = opts?.person;
  for (const candidate of candidates) {
    if (sameTopic(candidate.content, content, { category, person })) {
      return candidate.key;
    }
  }
  return null;
}

/**
 * Does this sentence ASSERT a safety condition — an allergy, an intolerance,
 * a restriction, a "must not"? A safety fact (allergy, restriction) may only
 * be replaced by another safety claim: "Bailey hates peanuts" is a PREFERENCE
 * and must never take the place of "Bailey is allergic to peanuts", however
 * many words they share.
 */
export function assertsSafety(content: string): boolean {
  const words = contentTokens(content);
  for (const word of words) {
    if (SAFETY_CLAIM_WORDS.has(word)) return true;
  }
  // The multi-word refusals ("must not", "can't have") are not single tokens.
  const text = foldAccents(String(content ?? '').toLowerCase());
  return /must not|cannot|can't|can not|no longer|not allowed|never/.test(text);
}

/** The words that mark a safety claim. */
const SAFETY_CLAIM_WORDS: ReadonlySet<string> = new Set([
  'allergic', 'allergy', 'allergies', 'intolerant', 'intolerance', 'avoid',
  'avoids', 'restricted', 'restriction', 'restrictions', 'tolerates',
  'sensitive', 'sensitivity', 'reaction', 'reactions', 'rash', 'swelling',
  'anaphylaxis', 'celiac', 'diabetes', 'epilepsy', 'asthma', 'excluded',
]);

/**
 * A key for a fact whose claimed key is ALREADY taken by a different fact.
 *
 * Two facts can claim the same subject key — most often when the caller
 * named a topic that both facts share ("peanuts" for an allergy and for a
 * pantry staple). The second one must not take the first one's place, so it
 * gets a key of its own, carrying its own topic. A number is added if that
 * is taken too.
 */
export function disambiguateKey(
  claimedKey: string,
  content: string,
  opts: { category?: string; person?: string; max?: number },
): string {
  const max = opts.max ?? 50;
  const topic = slugify(
    topicTokens(content, { category: opts.category, person: opts.person }).join(' '),
    12,
  );
  const base = `${claimedKey}_${topic}`.slice(0, max).replace(/_+$/g, '');
  if (!topic) return `${base}_2`.slice(0, max);
  for (let attempt = 2; attempt <= 10; attempt += 1) {
    const candidate = `${base}_${attempt}`.slice(0, max);
    if (candidate !== claimedKey) return candidate;
  }
  return `${base}_10`;
}
