/**
 * Playbooks — the PROCEDURAL memory. Hermes' `skills/` idea: a named
 * procedure for a task domain ("meals.add_emoji"). ONE live row per slug, so
 * a correction REPLACES the body (the old body lands in `history`) instead
 * of forking a second rule — the exact failure the live memory bank shows
 * with four copies of one emoji instruction.
 *
 * The same rules as the fact store: the slug is the IDENTITY, the body is
 * the family's own words (stored as written), and the row is replaced in
 * place with the old body kept in a bounded history.
 */

import { getAuthedPB } from "./pb-auth";

export interface PlaybookHistoryEntry {
  version: number;
  body: string;
  createdBy: string;
  at: string;
}

export interface PlaybookRow {
  id: string;
  slug: string;
  title: string;
  domain?: string;
  trigger?: string;
  body: string;
  version: number;
  status: string;
  history: PlaybookHistoryEntry[];
  useCount: number;
  lastUsed?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = "consuela_playbooks";
const MAX_HISTORY = 10;

function parseHistory(raw: unknown): PlaybookHistoryEntry[] {
  if (Array.isArray(raw)) return raw as PlaybookHistoryEntry[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlaybookHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function toRow(raw: any): PlaybookRow {
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? ""),
    title: String(raw.title ?? ""),
    domain: raw.domain ? String(raw.domain) : undefined,
    trigger: raw.trigger ? String(raw.trigger) : undefined,
    body: String(raw.body ?? ""),
    version: Number(raw.version ?? 1),
    status: String(raw.status ?? "active"),
    history: parseHistory(raw.history),
    useCount: Number(raw.useCount ?? 0),
    lastUsed: raw.lastUsed ? String(raw.lastUsed) : undefined,
    createdBy: String(raw.createdBy ?? "agent"),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

export async function listActivePlaybooks(): Promise<PlaybookRow[]> {
  try {
    const pb = await getAuthedPB();
    const rows = await pb.collection(COLLECTION).getFullList({
      filter: 'status != "archived"',
      sort: "slug",
      requestKey: null,
    }) as any[];
    return rows.map(toRow);
  } catch (error) {
    console.error("Failed to list playbooks:", error);
    return [];
  }
}

export async function getPlaybook(slug: string): Promise<PlaybookRow | null> {
  try {
    const pb = await getAuthedPB();
    const row = await pb.collection(COLLECTION).getFirstListItem(`slug = "${slug}"`, { requestKey: null });
    return toRow(row);
  } catch {
    return null;
  }
}

export async function writePlaybook(input: {
  slug: string;
  title: string;
  body: string;
  domain?: string;
  trigger?: string;
  createdBy?: string;
}): Promise<PlaybookRow | null> {
  const createdBy = input.createdBy ?? "agent";
  const now = new Date().toISOString();
  try {
    const pb = await getAuthedPB();
    const existing = await getPlaybook(input.slug);
    if (existing) {
      const history = [...existing.history, {
        version: existing.version,
        body: existing.body,
        createdBy: existing.createdBy,
        at: now,
      }].slice(-MAX_HISTORY);
      const updated = await pb.collection(COLLECTION).update(existing.id, {
        title: input.title,
        body: input.body,
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.trigger ? { trigger: input.trigger } : {}),
        version: existing.version + 1,
        status: "active",
        history: JSON.stringify(history),
        createdBy,
        updatedAt: now,
      }, { requestKey: null });
      return toRow(updated);
    }
    const created = await pb.collection(COLLECTION).create({
      slug: input.slug,
      title: input.title,
      body: input.body,
      domain: input.domain ?? "",
      trigger: input.trigger ?? "",
      version: 1,
      status: "active",
      history: JSON.stringify([]),
      useCount: 0,
      createdBy,
      createdAt: now,
      updatedAt: now,
    }, { requestKey: null });
    return toRow(created);
  } catch (error) {
    console.error("Failed to write playbook:", error);
    return null;
  }
}

export async function patchPlaybook(slug: string, body: string, createdBy = "agent"): Promise<PlaybookRow | null> {
  const existing = await getPlaybook(slug);
  if (!existing) return null;
  return writePlaybook({ slug, title: existing.title, body, domain: existing.domain, trigger: existing.trigger, createdBy });
}

export async function archivePlaybook(slug: string): Promise<boolean> {
  try {
    const pb = await getAuthedPB();
    const existing = await getPlaybook(slug);
    if (!existing) return false;
    await pb.collection(COLLECTION).update(existing.id, {
      status: "archived",
      updatedAt: new Date().toISOString(),
    }, { requestKey: null });
    return true;
  } catch (error) {
    console.error("Failed to archive playbook:", error);
    return false;
  }
}

export async function incrementPlaybookUsage(slug: string): Promise<void> {
  try {
    const pb = await getAuthedPB();
    const existing = await getPlaybook(slug);
    if (!existing) return;
    await pb.collection(COLLECTION).update(existing.id, {
      useCount: existing.useCount + 1,
      lastUsed: new Date().toISOString(),
    }, { requestKey: null });
  } catch (error) {
    console.error("Failed to increment playbook usage:", error);
  }
}
