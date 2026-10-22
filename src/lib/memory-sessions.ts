/**
 * Session search — the episodic plane. "Did we discuss X last week?"
 *
 * App-side on purpose: a PocketBase FTS5 virtual table would be a schema
 * PocketBase does not own, and the family's chat volume is small enough to
 * scan in memory.
 */

import { getAuthedPB } from "./pb-auth";
import { searchMessages, tokenize } from "./memory-search";

export interface ChatTurn {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  threadId?: string;
}

const DAY_MS = 86_400_000;

export async function loadRecentTurns(options?: { days?: number; limit?: number }): Promise<ChatTurn[]> {
  const days = options?.days ?? 30;
  const limit = options?.limit ?? 3000;
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  try {
    const pb = await getAuthedPB();
    const rows = await pb.collection("chat_messages").getFullList({
      filter: `createdAt>"${since}"`,
      sort: "-createdAt",
      requestKey: null,
    }) as any[];
    return rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      role: String(row.role ?? ""),
      content: String(row.content ?? ""),
      createdAt: String(row.createdAt ?? ""),
      threadId: row.threadId ? String(row.threadId) : undefined,
    }));
  } catch (error) {
    console.error("Failed to load recent turns:", error);
    return [];
  }
}

export async function searchConversations(query: string, limit = 8): Promise<ChatTurn[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const turns = await loadRecentTurns();
  return searchMessages(turns, terms, limit);
}
