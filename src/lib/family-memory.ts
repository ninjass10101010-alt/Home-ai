/**
 * AI Family Memory Bank
 *
 * A fact's `key` is its SUBJECT — the stable identity of what the family
 * said — NOT a slug of the wording. That is the whole point of this store:
 * the existing `UNIQUE(userId, key)` index becomes the "one row per subject"
 * guarantee, so a correction REPLACES the row in place and the previous
 * wording lands in the bounded `history` field instead of forking a second
 * row for the same subject (the live bank held four rows for one emoji
 * rule).
 *
 * THE FAMILY'S TEXT IS STORED AS IT WAS WRITTEN. Only the subject KEY is
 * folded (NFKD, combining marks stripped, plus the letters Unicode cannot
 * decompose), because a key is a MACHINE identity and a PocketBase `~` is a
 * byte-wise LIKE: it folds ASCII case and nothing else. Reachability does
 * not depend on the fold — Task 1's `tokenize` emits the folded AND the raw
 * form of every accented word, and `buildMemoryFilter` carries both, so a
 * row stored WITH its accent is reached either way (proved against a real
 * PocketBase: the filter for "Begoña" and the filter for "begona" both find
 * the row "Begoña loves tacos"). Folding the CONTENT, the tags or the
 * person would rewrite the family's own words — "Begoña" → "Begona" — in
 * the console, in the prompt the model reads, in the agent's answer and in
 * the export, irreversibly (the history held the folded text too, so the
 * raw spelling was stored NOWHERE).
 */

import { getAuthedPB } from './pb-auth';
import { buildMemoryFilter, foldAccents, parseTagList, scoreMemory, tokenize } from './memory-search';
import { withKeyedLock } from './keyed-lock';

export type MemoryCategory =
  | 'preference' // Food preferences, activity preferences
  | 'allergy' // Allergies, medical conditions
  | 'routine' // Daily routines, weekly patterns
  | 'location' // Common addresses, favorite places
  | 'schedule' // Recurring events, time preferences
  | 'personality' // Personality traits, interests
  | 'restriction' // Dietary restrictions, screen time limits
  | 'contact' // Contact information, relationships
  | 'note' // General notes
  | 'rule'; // A standing instruction the family gives the agent

/** One superseded wording of a fact, kept so a correction is auditable. */
export interface MemoryHistoryEntry {
  version: number;
  content: string;
  source: string;
  by: string;
  at: string;
}

export interface FamilyMemory {
  id: string;
  userId: string;
  familyId: string;
  category: MemoryCategory;
  key: string; // SUBJECT KEY — the stable identity of the fact
  content: string; // the current wording of that subject
  tags: string[];
  confidence: number; // 0-1, how confident the AI is about this memory
  person: string; // who the fact is about
  scope: string; // 'person' | 'family'
  status: string; // 'active' | 'archived'
  version: number; // how many times this subject has been rewritten
  history: MemoryHistoryEntry[]; // the superseded wordings, newest last
  source: string; // who wrote the current wording
  createdAt: string;
  updatedAt: string;
  lastUsed?: string;
  usageCount: number;
}

export interface MemoryQuery {
  userId?: string;
  familyId?: string;
  category?: MemoryCategory;
  key?: string;
  person?: string;
  tags?: string[];
  search?: string; // Full-text search
  limit?: number;
}

export interface MemoryUpdate {
  content?: string;
  tags?: string[];
  confidence?: number;
  person?: string;
  scope?: string;
}

/** Everything a fact needs. The KEY is the subject — the store never derives
 *  one from the content, because that is what made a rewording fork a row. */
export interface StoreMemoryInput {
  userId: string;
  familyId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  tags?: string[];
  confidence?: number;
  person?: string;
  scope?: string;
  source?: string;
}

/**
 * A refusal the caller MUST be told about, as opposed to an outage.
 *
 * `storeMemory` answers `null` when a write fails (the established failure
 * signal: "try again later"), but a refusal is a different thing — the
 * correction was NOT saved, and why matters. The route turns the code into
 * its HTTP answer, so the family is never told "saved" when it was not.
 */
export class MemoryStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemoryStoreError';
    this.code = code;
  }
}

/**
 * Is this error the store REFUSING a write, as opposed to an outage?
 *
 * The callers (the route, the agent tool) answer a refusal and an outage
 * differently: "the bank cannot save that yet — nothing was changed" is not
 * "the bank is down, try again later". The check is by NAME so a caller does
 * not have to import the class to recognise one — and so a store that is
 * mocked (or bundled) still answers the same way.
 */
export function isMemoryRefusal(error: unknown): boolean {
  const err = error as any;
  return err?.name === 'MemoryStoreError' && typeof err?.code === 'string';
}

/** How many superseded wordings a subject keeps. The history is an audit
 *  trail, not an archive: an unbounded one would grow the row until
 *  PocketBase's row-size ceiling rejected the write. */
const MAX_HISTORY = 10;
/** The longest a subject key may be — the same cap the key builder uses. */
const MAX_KEY = 50;

const COLLECTION = 'consuela_family_memories';

/** The most rows ONE read may pull. The chat turn reads the bank on every
 *  parent message, so an unbounded read is a full-table scan per turn. */
const MAX_ROWS = 1000;
/** How many rows one PocketBase page may carry. */
const FETCH_PAGE = 200;
/** The candidates a search scores before the limit is applied — the ranking
 *  needs more than the answer, or the best match can sit outside the limit. */
const SEARCH_CANDIDATES = 200;

/** The columns a read pulls. A projection bounds the bytes one read costs. */
const READ_FIELDS = [
  'id', 'userId', 'familyId', 'category', 'key', 'content', 'tags', 'confidence',
  'usageCount', 'lastUsed', 'createdAt', 'updatedAt', 'person', 'scope', 'status',
  'version', 'history', 'source',
].join(',');

/** A value interpolated into an EQUALITY filter. A quote or a backslash
 *  breaks the filter, and PocketBase REJECTS a broken filter — a lookup that
 *  cannot run is a fact that silently does not get written. Underscores are
 *  kept: they are part of every subject key. */
function equalityValue(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

/**
 * Fold AND lowercase for the KEY — a machine identity, not the family's
 * words. The lowercasing matters: PocketBase's `=` filter is case-sensitive
 * in SQLite, so a key stored as "UPPER_KEY" and one stored as "upper_key"
 * would be TWO rows under a UNIQUE index that cannot see the difference.
 */
function foldKey(value: string): string {
  return foldAccents(String(value ?? '').toLowerCase());
}

/** Compare two names the way the family means them: case- and
 *  accent-insensitively. The STORED text keeps its accent; the comparison
 *  folds both sides. */
function foldName(value: string): string {
  return foldAccents(String(value ?? '').trim().toLowerCase());
}

/** Is this row archived? The comparison is case- and space-insensitive:
 *  "Archived" must not slip past a filter that only knows "archived". */
function isArchived(row: { status?: string }): boolean {
  return String(row.status ?? '').trim().toLowerCase() === 'archived';
}

/** A number PocketBase hands back, or a fallback. An unset field reads back
 *  as 0 (a number) or "" (a text) — never as null — so `??` does not catch
 *  it and the fallback has to be an explicit "empty" test. */
function numberOr(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** The row's version. A row written before the `version` column existed
 *  reads back as 0 — and 0 is not a version: the first version is 1. */
function versionOf(row: any): number {
  const n = Number(row?.version);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseHistory(raw: unknown): MemoryHistoryEntry[] {
  if (Array.isArray(raw)) return raw as MemoryHistoryEntry[];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** A PocketBase row is not a FamilyMemory: `tags` and `history` arrive as
 *  JSON strings, and the newer fields are absent on rows written before they
 *  existed. Every reader goes through here, so no caller has to know that.
 *  An EMPTY field means "never set" — PocketBase returns "" for an unset
 *  text field and 0 for an unset number, and `??` does not catch either. */
function toMemory(row: any): FamilyMemory {
  return {
    ...row,
    tags: parseTagList(row.tags),
    history: parseHistory(row.history),
    person: String(row.person ?? ''),
    scope: String(row.scope ?? '') || (row.person ? 'person' : 'family'),
    status: String(row.status ?? '') || 'active',
    version: versionOf(row),
    source: String(row.source ?? '') || 'agent',
    confidence: numberOr(row.confidence, 0.8),
    usageCount: numberOr(row.usageCount, 0),
  };
}

/**
 * Did the READ fail, or is the row simply missing?
 *
 * PocketBase answers a missing record with a 404 (the SDK turns "no items"
 * into a ClientResponseError with status 404); every other failure — a
 * timeout, a rejected filter, an expired admin token — is a FAILED READ.
 * The two must not be confused: treating a failed read as "not found" makes
 * the store CREATE a second row for a subject that already exists, the
 * UNIQUE index turns that create into a 400, and the family's correction is
 * lost on a perfectly healthy store.
 */
function isMissingRow(error: unknown): boolean {
  const err = error as any;
  if (!err) return false;
  if (err.status === 404) return true;
  if (err.response?.status === 404) return true;
  if (err.response?.code === 404) return true;
  if (err.response?.data?.code === 404) return true;
  if (err.code === 404) return true;
  return false;
}

/** The row for this subject, or null when it does not exist. A failed read
 *  is NOT a missing row: it travels to the caller. */
async function readSubject(pb: any, userId: string, key: string): Promise<any | null> {
  try {
    return await pb.collection(COLLECTION).getFirstListItem(
      `userId = "${userId}" && key = "${key}"`,
      { requestKey: null },
    );
  } catch (error) {
    if (isMissingRow(error)) return null;
    throw error;
  }
}

/**
 * Refuse a destructive write while the Task-3 columns are not live.
 *
 * A write that carries a field the collection does not declare SUCCEEDS
 * (200) and PocketBase DROPS the unknown field — so between Task 2 and Task 3
 * a correction replaced the row and DESTROYED the previous wording: the
 * history write was dropped with it. The tell is the row itself: a record
 * read back from a collection without the columns has NO `version` and NO
 * `history` key at all (a collection that HAS them reads them back as 0 and
 * null, which is a different thing — that row is safe to correct).
 */
function assertHistoryColumns(existing: any): void {
  const hasVersion = existing?.version !== undefined && existing?.version !== null;
  const hasHistory = existing?.history !== undefined && existing?.history !== null;
  if (hasVersion || hasHistory) return;
  throw new MemoryStoreError(
    'memory_schema_not_ready',
    'The memory bank schema is not live yet — refusing to overwrite a fact whose history could not be kept.',
  );
}

/**
 * Store a fact under its SUBJECT KEY. If the subject already exists the row
 * is replaced in place — the previous wording lands in `history` — so a
 * restatement is never a second row. The `UNIQUE(userId, key)` index is the
 * guarantee; this lookup is how the row is found.
 */
/** Write a brand-new subject row. */
async function writeNewSubject(
  pb: any,
  args: {
    userId: string; familyId: string; category: MemoryCategory; key: string;
    content: string; tags: string[]; person: string; scope: string;
    source: string; confidence: number; now: string;
  },
): Promise<FamilyMemory> {
  const created = await pb.collection(COLLECTION).create({
    userId: args.userId,
    familyId: args.familyId,
    category: args.category,
    key: args.key,
    content: args.content,
    tags: JSON.stringify(args.tags),
    person: args.person,
    scope: args.scope,
    status: 'active',
    source: args.source,
    confidence: args.confidence,
    version: 1,
    history: JSON.stringify([]),
    createdAt: args.now,
    updatedAt: args.now,
    usageCount: 1,
    lastUsed: args.now,
  }, { requestKey: null });
  return toMemory(created);
}

export async function storeMemory(input: StoreMemoryInput): Promise<FamilyMemory | null> {
  // The KEY is a machine identity, so it is folded. The CONTENT, the tags
  // and the person are the family's own words and are stored AS WRITTEN.
  const key = equalityValue(foldKey(input.key));
  const userId = equalityValue(input.userId);
  const familyId = equalityValue(input.familyId);
  const content = String(input.content ?? '');
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => String(tag)).filter(Boolean) : [];
  const person = String(input.person ?? '');
  const scope = input.scope ?? (person ? 'person' : 'family');
  const source = input.source ?? 'agent';
  const confidence = input.confidence ?? 0.8;
  const now = new Date().toISOString();
  if (!key) {
    // The key IS the identity. An empty one would collide with every other
    // empty-key fact under UNIQUE(userId, key) — one row for all of them.
    console.error('Refusing to store a memory with no subject key');
    return null;
  }
  if (!content.trim()) {
    // A fact with no text is not a fact. Accepting it would let a blank
    // write erase what the family said.
    console.error('Refusing to store a memory with no content');
    return null;
  }
  try {
    const pb = await getAuthedPB();
    // The read-modify-write of ONE subject is serialised: two corrections at
    // once used to both read version 1, both write version 2, and one
    // superseded wording was LOST.
    return await withKeyedLock(`memory:${userId}:${key}`, async () => {
      const existing = await readSubject(pb, userId, key);
      if (existing) {
        // The KEY is the identity: storing under the same key REPLACES the
        // row (the old wording lands in the history). Choosing a key that is
        // already claimed by a DIFFERENT fact is the caller's job — see
        // `disambiguateKey` in memory-subject.ts, which the agent's tool and
        // the console's route both use.
        assertHistoryColumns(existing);
        const history = [...parseHistory(existing.history), {
          version: versionOf(existing),
          content: String(existing.content ?? ''),
          source: String(existing.source ?? '') || 'agent',
          // The store has no human author — the source is the honest
          // attribution until `replaceMemoryContent` carries a name.
          by: source,
          at: now,
        }].slice(-MAX_HISTORY);
        const updated = await pb.collection(COLLECTION).update(existing.id, {
          content,
          // The family's identity is (userId, key): the row belongs to the
          // family it was last written into.
          familyId,
          category: input.category,
          tags: JSON.stringify(tags),
          person,
          scope,
          status: 'active',
          source,
          confidence,
          version: versionOf(existing) + 1,
          history: JSON.stringify(history),
          updatedAt: now,
          usageCount: (Number(existing.usageCount) || 0) + 1,
          lastUsed: now,
        }, { requestKey: null });
        return toMemory(updated);
      }

      return await writeNewSubject(pb, {
        userId, familyId, category: input.category, key,
        content, tags, person, scope, source, confidence, now,
      });
    });
  } catch (error) {
    if (error instanceof MemoryStoreError) throw error;
    console.error('Failed to store memory:', error);
    return null;
  }
}

/** Replace the wording of an existing subject, keeping the old one in the
 * history. Returns null when the subject does not exist — or when the new
 * text is empty, because an empty correction must never erase a fact. */
export async function replaceMemoryContent(input: {
  userId: string;
  familyId: string;
  key: string;
  content: string;
  category?: MemoryCategory;
  person?: string;
  scope?: string;
  source?: string;
  by?: string;
}): Promise<FamilyMemory | null> {
  const key = equalityValue(foldKey(input.key));
  const userId = equalityValue(input.userId);
  const familyId = equalityValue(input.familyId);
  const content = String(input.content ?? '');
  const source = input.source ?? 'agent';
  const by = input.by ?? source;
  const now = new Date().toISOString();
  if (!content.trim()) {
    console.error('Refusing to replace a fact with empty content');
    return null;
  }
  try {
    const pb = await getAuthedPB();
    return await withKeyedLock(`memory:${userId}:${key}`, async () => {
      const existing = await readSubject(pb, userId, key);
      if (!existing) return null;
      assertHistoryColumns(existing);
      const history = [...parseHistory(existing.history), {
        version: versionOf(existing),
        content: String(existing.content ?? ''),
        source: String(existing.source ?? '') || 'agent',
        by,
        at: now,
      }].slice(-MAX_HISTORY);
      const updated = await pb.collection(COLLECTION).update(existing.id, {
        content,
        familyId,
        ...(input.category ? { category: input.category } : {}),
        ...(input.person !== undefined ? { person: String(input.person) } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        source,
        version: versionOf(existing) + 1,
        history: JSON.stringify(history),
        updatedAt: now,
        lastUsed: now,
      }, { requestKey: null });
      return toMemory(updated);
    });
  } catch (error) {
    if (error instanceof MemoryStoreError) throw error;
    console.error('Failed to replace memory content:', error);
    return null;
  }
}

/** How many rows a read may pull. A caller's `limit` is the most it asked
 *  for; a search needs more candidates than it returns. */
function readCeiling(limit: number, searching: boolean): number {
  const wanted = searching ? Math.max(limit, SEARCH_CANDIDATES) : limit;
  return Math.min(Math.max(wanted, 1), MAX_ROWS);
}

/**
 * Read rows, page by page, up to a ceiling.
 *
 * `getFullList` walks the WHOLE collection (the SDK paginates until the last
 * page), and the chat turn reads the bank on every parent message — so a
 * full-table read per turn. This walks only as far as the caller asked, with
 * a projection so each row costs only what the store reads.
 */
async function fetchRows(
  pb: any,
  filter: string,
  maxRows: number,
): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (out.length < maxRows) {
    const perPage = Math.min(FETCH_PAGE, maxRows - out.length);
    const result = await pb.collection(COLLECTION).getList(page, perPage, {
      ...(filter ? { filter } : {}),
      sort: '-confidence,-usageCount',
      fields: READ_FIELDS,
      requestKey: null,
    });
    const items = result?.items ?? [];
    out.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }
  return out;
}

/**
 * Retrieve memories matching a query.
 *
 * The search is a TOKENISED OR over content, tags and key — the old code
 * filtered on the whole message, which is a verbatim LIKE and could never
 * match a memory row.
 */
export async function queryMemories(query: MemoryQuery): Promise<FamilyMemory[]> {
  try {
    const pb = await getAuthedPB();
    const filters: string[] = [];
    if (query.userId) filters.push(`userId = "${equalityValue(query.userId)}"`);
    if (query.familyId) filters.push(`familyId = "${equalityValue(query.familyId)}"`);
    if (query.category) filters.push(`category = "${equalityValue(query.category)}"`);
    // The KEY is folded on write, so the query is folded too — otherwise
    // "person_begoña" could never find the row stored as "person_begona".
    if (query.key) filters.push(`key = "${equalityValue(foldKey(query.key))}"`);

    const base = filters.join(' && ');
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), MAX_ROWS);
    const searchText = typeof query.search === 'string' ? query.search : '';
    const searching = searchText.trim() !== '';
    const terms = searching ? tokenize(searchText) : [];
    // A search whose every word is a stop word matches NOTHING. Falling
    // through to "no filter" would answer with the WHOLE bank — the family's
    // every fact — for a one-word message.
    if (searching && terms.length === 0) return [];
    const search = terms.length ? buildMemoryFilter(terms) : '';

    const rows = await fetchRows(
      pb,
      [base, search].filter(Boolean).join(' && '),
      readCeiling(limit, terms.length > 0),
    );

    let memories = rows.map(toMemory)
      // An archived fact never answers a query. The check is HERE as well as
      // in the PocketBase filter because `status` arrives with the schema
      // migration: a filter naming a column the collection does not have yet
      // is a 400, and a 400 the catch swallows is a bank that reads as EMPTY.
      .filter((m) => !isArchived(m));

    if (query.person) {
      const wanted = foldName(query.person);
      memories = memories.filter((m) => {
        const who = foldName(m.person);
        const tagged = m.tags.some((t) => foldName(t).includes(wanted));
        // A fact with NO person is family-wide, not about this person: an
        // empty name is a substring of every name, so an unguarded check
        // would answer "what does Bailey like?" with every household fact.
        if (!who) return tagged;
        return who === wanted || who.includes(wanted) || wanted.includes(who) || tagged;
      });
    }

    if (query.tags && query.tags.length > 0) {
      const wanted = query.tags.map((tag) => foldName(tag));
      memories = memories.filter((m) => wanted.some((tag) =>
        m.tags.some((t) => foldName(t) === tag),
      ));
    }

    if (terms.length) {
      memories = memories
        .map((m) => ({ m, s: scoreMemory(m, terms, { speakerName: query.person }) }))
        .filter((e) => e.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((e) => e.m);
    }

    return memories.slice(0, limit);
  } catch (error) {
    // A dead store is NOT an empty bank. Returning [] here is a confident
    // "the family has no memories" — the answer this codebase gave during a
    // PocketBase outage — so the failure travels to the caller, which can
    // say the memory store is down.
    console.error('Failed to query memories:', error);
    throw error;
  }
}

/** Every active fact for the family — the input to the always-injected block. */
export async function listActiveFacts(familyId: string, limit = 200): Promise<FamilyMemory[]> {
  const rows = await queryMemories({ familyId, limit });
  // An empty status means the column was never set (a row written before
  // the schema change), and such a row IS active — dropping it would empty
  // the always-injected core block.
  return rows.filter((m) => String(m.status).trim().toLowerCase() === 'active');
}

/**
 * Get all memories for a family
 */
export async function getFamilyMemories(familyId: string): Promise<FamilyMemory[]> {
  return queryMemories({
    familyId,
    limit: 100,
  });
}

/**
 * Update a memory
 */
export async function updateMemory(
  memoryId: string,
  updates: MemoryUpdate
): Promise<FamilyMemory | null> {
  try {
    const pb = await getAuthedPB();
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    // The family's own words — stored as written.
    if (updates.content !== undefined) {
      const next = String(updates.content);
      if (!next.trim()) {
        // An empty correction must never erase a fact. The console's edit
        // box can be emptied by accident, and a blank write would leave the
        // family with a row that says nothing.
        console.error('Refusing to blank a memory');
        return null;
      }
      const current = await pb.collection(COLLECTION).getOne(memoryId, { requestKey: null });
      if (String(current.content ?? '') !== next) {
        // The console's edit is a CORRECTION, so it goes through the same
        // history + version path as every other replacement: the old wording
        // is kept, and the row's version moves on.
        const history = [...parseHistory(current.history), {
          version: versionOf(current),
          content: String(current.content ?? ''),
          source: String(current.source ?? '') || 'parent',
          by: 'parent',
          at: new Date().toISOString(),
        }].slice(-MAX_HISTORY);
        updateData.history = JSON.stringify(history);
        updateData.version = versionOf(current) + 1;
      }
      updateData.content = next;
    }
    if (updates.tags !== undefined) {
      updateData.tags = JSON.stringify(
        Array.isArray(updates.tags) ? updates.tags.map((tag) => String(tag)).filter(Boolean) : [],
      );
    }
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates.person !== undefined) updateData.person = String(updates.person);
    if (updates.scope !== undefined) updateData.scope = updates.scope;

    const memory = await pb.collection(COLLECTION).update(
      memoryId,
      updateData,
      { requestKey: null }
    );

    return toMemory(memory);
  } catch (error) {
    console.error('Failed to update memory:', error);
    return null;
  }
}

/**
 * Delete a memory
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  try {
    const pb = await getAuthedPB();
    await pb.collection(COLLECTION).delete(memoryId, {
      requestKey: null,
    });
    return true;
  } catch (error) {
    console.error('Failed to delete memory:', error);
    return false;
  }
}

/**
 * Build context for AI conversations using family memories
 */
export async function buildMemoryContext(
  userId: string,
  familyId: string,
  currentMessage: string
): Promise<string> {
  // Get relevant memories based on current message
  const relevantMemories = await queryMemories({
    userId,
    familyId,
    search: currentMessage,
    limit: 10,
  });

  if (relevantMemories.length === 0) {
    return '';
  }

  // Format memories as context
  const contextLines = relevantMemories.map(m => {
    const who = m.person || m.tags.join(', ');
    return `- ${m.category}${who ? ` (${who})` : ''}: ${m.content}`;
  });

  return `\nFamily Context:\n${contextLines.join('\n')}\n`;
}

/**
 * Increment usage count for a memory (for learning)
 */
export async function incrementMemoryUsage(memoryId: string): Promise<void> {
  try {
    const pb = await getAuthedPB();
    const memory = await pb.collection(COLLECTION).getOne(memoryId, {
      requestKey: null,
    });

    await pb.collection(COLLECTION).update(
      memoryId,
      {
        usageCount: (Number(memory.usageCount) || 0) + 1,
        lastUsed: new Date().toISOString(),
      },
      { requestKey: null }
    );
  } catch (error) {
    console.error('Failed to increment memory usage:', error);
  }
}

/**
 * Get statistics about family memories
 */
export async function getMemoryStats(familyId: string): Promise<{
  totalMemories: number;
  byCategory: Record<string, number>;
  mostUsedMemories: FamilyMemory[];
  recentlyUpdated: FamilyMemory[];
}> {
  try {
    const allMemories = await getFamilyMemories(familyId);

    const byCategory: Record<string, number> = {};
    allMemories.forEach(m => {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    });

    const mostUsedMemories = [...allMemories]
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, 10);

    const recentlyUpdated = [...allMemories]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10);

    return {
      totalMemories: allMemories.length,
      byCategory,
      mostUsedMemories,
      recentlyUpdated,
    };
  } catch (error) {
    // Zero memories is an answer, not a fallback: a caller that renders
    // "0 memories" during an outage is telling the family their bank is
    // empty. The route turns the throw into a 503.
    console.error('Failed to get memory stats:', error);
    throw error;
  }
}
