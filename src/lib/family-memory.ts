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
 * FOLD ON WRITE: `content`, `tags`, `person` and `key` are stored folded
 * (NFKD, combining marks stripped, plus the letters Unicode cannot
 * decompose), because a PocketBase `~` is a byte-wise LIKE — it folds ASCII
 * case and NOTHING else — so a row stored with its accent can never be
 * reached by the folded form of the name that fetches it. The fold is the
 * retrieval engine's, shared: a second implementation would drift.
 */

import { getAuthedPB } from './pb-auth';
import { buildMemoryFilter, foldAccents, parseTagList, scoreMemory, tokenize } from './memory-search';

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

/** How many superseded wordings a subject keeps. The history is an audit
 *  trail, not an archive: an unbounded one would grow the row until
 *  PocketBase's row-size ceiling rejected the write. */
const MAX_HISTORY = 10;

const COLLECTION = 'consuela_family_memories';

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

/** Fold for storage: the same fold the retrieval engine applies when it
 *  compares, so a byte-wise LIKE can reach the row. */
function foldForStorage(value: string): string {
  return foldAccents(String(value ?? ''));
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
 *  existed. Every reader goes through here, so no caller has to know that. */
function toMemory(row: any): FamilyMemory {
  return {
    ...row,
    tags: parseTagList(row.tags),
    history: parseHistory(row.history),
    person: row.person ?? '',
    scope: row.scope ?? (row.person ? 'person' : 'family'),
    status: row.status ?? 'active',
    version: Number(row.version ?? 1),
    source: row.source ?? 'agent',
    confidence: Number(row.confidence ?? 0.8),
    usageCount: Number(row.usageCount ?? 0),
  };
}

/**
 * Store a fact under its SUBJECT KEY. If the subject already exists the row
 * is replaced in place — the previous wording lands in `history` — so a
 * restatement is never a second row. The `UNIQUE(userId, key)` index is the
 * guarantee; this lookup is how the row is found.
 */
export async function storeMemory(input: StoreMemoryInput): Promise<FamilyMemory | null> {
  const key = equalityValue(foldForStorage(input.key));
  const userId = equalityValue(input.userId);
  const familyId = equalityValue(input.familyId);
  const content = foldForStorage(input.content);
  const tags = (input.tags ?? []).map((tag) => foldForStorage(tag)).filter(Boolean);
  const person = foldForStorage(input.person ?? '');
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
  try {
    const pb = await getAuthedPB();
    const existing = await pb.collection(COLLECTION)
      .getFirstListItem(
        `userId = "${userId}" && key = "${key}"`,
        { requestKey: null }
      )
      .catch(() => null);

    if (existing) {
      const history = [...parseHistory(existing.history), {
        version: Number(existing.version ?? 1),
        content: foldForStorage(String(existing.content ?? '')),
        source: String(existing.source ?? 'agent'),
        // The store has no human author — the source is the honest
        // attribution until `replaceMemoryContent` carries a name.
        by: source,
        at: now,
      }].slice(-MAX_HISTORY);
      const updated = await pb.collection(COLLECTION).update(existing.id, {
        content,
        category: input.category,
        tags: JSON.stringify(tags),
        person,
        scope,
        status: 'active',
        source,
        confidence,
        version: Number(existing.version ?? 1) + 1,
        history: JSON.stringify(history),
        updatedAt: now,
        usageCount: (existing.usageCount || 0) + 1,
        lastUsed: now,
      }, { requestKey: null });
      return toMemory(updated);
    }

    const created = await pb.collection(COLLECTION).create({
      userId,
      familyId,
      category: input.category,
      key,
      content,
      tags: JSON.stringify(tags),
      person,
      scope,
      status: 'active',
      source,
      confidence,
      version: 1,
      history: JSON.stringify([]),
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
      lastUsed: now,
    }, { requestKey: null });
    return toMemory(created);
  } catch (error) {
    console.error('Failed to store memory:', error);
    return null;
  }
}

/** Replace the wording of an existing subject, keeping the old one in the
 *  history. Returns null when the subject does not exist. */
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
  const key = equalityValue(foldForStorage(input.key));
  const userId = equalityValue(input.userId);
  const content = foldForStorage(input.content);
  const source = input.source ?? 'agent';
  const by = input.by ?? source;
  const now = new Date().toISOString();
  try {
    const pb = await getAuthedPB();
    const existing = await pb.collection(COLLECTION)
      .getFirstListItem(
        `userId = "${userId}" && key = "${key}"`,
        { requestKey: null }
      )
      .catch(() => null);
    if (!existing) return null;
    const history = [...parseHistory(existing.history), {
      version: Number(existing.version ?? 1),
      content: foldForStorage(String(existing.content ?? '')),
      source: String(existing.source ?? 'agent'),
      by,
      at: now,
    }].slice(-MAX_HISTORY);
    const updated = await pb.collection(COLLECTION).update(existing.id, {
      content,
      ...(input.category ? { category: input.category } : {}),
      ...(input.person !== undefined ? { person: foldForStorage(input.person) } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      source,
      version: Number(existing.version ?? 1) + 1,
      history: JSON.stringify(history),
      updatedAt: now,
      lastUsed: now,
    }, { requestKey: null });
    return toMemory(updated);
  } catch (error) {
    console.error('Failed to replace memory content:', error);
    return null;
  }
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
    if (query.key) filters.push(`key = "${equalityValue(query.key)}"`);

    const base = filters.join(' && ');
    const limit = query.limit || 50;
    const terms = query.search ? tokenize(query.search) : [];
    const search = terms.length ? buildMemoryFilter(terms) : '';

    let rows: any[] = [];
    if (search) {
      rows = await pb.collection(COLLECTION).getFullList({
        filter: base ? `${base} && ${search}` : search,
        sort: '-confidence,-usageCount',
        requestKey: null,
      }) as any[];
    } else {
      rows = await pb.collection(COLLECTION).getFullList({
        ...(base ? { filter: base } : {}),
        sort: '-confidence,-usageCount',
        requestKey: null,
      }) as any[];
    }

    let memories = rows.map(toMemory)
      // An archived fact never answers a query. The check is HERE as well as
      // in the PocketBase filter because `status` arrives with the schema
      // migration: a filter naming a column the collection does not have yet
      // is a 400, and a 400 the catch swallows is a bank that reads as EMPTY.
      .filter((m) => m.status !== 'archived');

    if (query.person) {
      const wanted = query.person.toLowerCase();
      memories = memories.filter((m) => {
        const who = m.person.toLowerCase();
        const tagged = m.tags.some((t) => t.toLowerCase().includes(wanted));
        // A fact with NO person is family-wide, not about this person: an
        // empty name is a substring of every name, so an unguarded check
        // would answer "what does Bailey like?" with every household fact.
        if (!who) return tagged;
        return who === wanted || who.includes(wanted) || wanted.includes(who) || tagged;
      });
    }

    if (query.tags && query.tags.length > 0) {
      memories = memories.filter((m) => query.tags!.some((tag) =>
        m.tags.some((t) => t.toLowerCase() === tag.toLowerCase()),
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
  return rows.filter((m) => m.status === 'active');
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

    if (updates.content !== undefined) updateData.content = foldForStorage(updates.content);
    if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags.map((tag) => foldForStorage(tag)));
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates.person !== undefined) updateData.person = foldForStorage(updates.person);
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
        usageCount: (memory.usageCount || 0) + 1,
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
    // empty. The route turns the throw into a 500.
    console.error('Failed to get memory stats:', error);
    throw error;
  }
}
