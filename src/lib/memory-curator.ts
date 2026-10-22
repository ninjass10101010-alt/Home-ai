/**
 * The curator — the Hermes maintenance pass, adapted.
 *
 * Phase 1 (deterministic, auto-applied): merge near-duplicate facts, archive
 * stale facts and playbooks. These changes cannot alter meaning.
 * Phase 2 (LLM review) lives in the cron route and is PARENT-APPROVED.
 *
 * Every run snapshots the rows it touched into `consuela_memory_runs`, so the
 * family can undo it. A safety fact is never auto-archived and never merged
 * away.
 */

import { getAuthedPB } from "./pb-auth";
import { listActiveFacts } from "./family-memory";
import { listActivePlaybooks, archivePlaybook } from "./memory-playbooks";
import { sameTopic } from "./memory-subject";

const DAY_MS = 86_400_000;
export const FACT_STALE_DAYS = 90;
export const PLAYBOOK_STALE_DAYS = 60;
const SAFETY_CATEGORIES = new Set(["allergy", "restriction"]);

export interface MemoryRunChange {
  kind: "fact" | "playbook";
  action: "merge" | "archive";
  id: string;
  key?: string;
  note: string;
}

export interface MemoryRun {
  id: string;
  runId: string;
  trigger: string;
  summary: string;
  changes: MemoryRunChange[];
  snapshot: { facts?: any[]; playbooks?: any[] };
  report: string;
  startedAt: string;
  finishedAt: string;
  undoneAt?: string;
}

export interface CuratorOptions {
  trigger: string;
  dryRun?: boolean;
  now?: number;
}

function isSafety(fact: any): boolean {
  return SAFETY_CATEGORIES.has(String(fact?.category ?? ""));
}

function lastTouched(fact: any): number {
  const value = fact?.lastUsed || fact?.updatedAt || 0;
  const parsed = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** What the deterministic phase WOULD do. Pure, so it is testable. */
export function planConsolidation(facts: any[], now: number) {
  const merges: Array<{ keepId: string; dropId: string }> = [];
  const archives: string[] = [];
  const changes: MemoryRunChange[] = [];

  // Merge near-duplicates inside a category — only when the topics match
  // EXACTLY (the same set of informative words). A shared word is not an
  // identity: "peanut butter" and "peanut oil" share "peanut" but are two
  // different allergies. The merge uses the SAME rule the store uses, so
  // the curator never collapses what the store refused to collapse.
  const byCategory = new Map<string, any[]>();
  for (const fact of facts) {
    if (fact?.status === "archived") continue;
    const category = String(fact?.category ?? "note");
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(fact);
  }
  for (const [category, group] of byCategory) {
    for (const fact of group) {
      if (isSafety(fact)) continue;
      if (merges.some((m) => m.dropId === fact.id)) continue;
      const keep = group
        .filter((other) => other.id !== fact.id && !merges.some((m) => m.dropId === other.id))
        .filter((other) => sameTopic(other.content ?? "", fact.content ?? "", { category, person: other.person }))
        .sort((a, b) => lastTouched(b) - lastTouched(a))[0];
      if (keep && lastTouched(keep) >= lastTouched(fact)) {
        merges.push({ keepId: keep.id, dropId: fact.id });
        changes.push({ kind: "fact", action: "merge", id: fact.id, key: fact.key, note: `merged into ${keep.key}` });
      }
    }
  }

  // Archive stale facts — never a safety fact.
  for (const fact of facts) {
    if (fact?.status === "archived") continue;
    if (isSafety(fact)) continue;
    if (merges.some((m) => m.dropId === fact.id)) continue;
    const touched = lastTouched(fact);
    if (!touched) continue;
    if (now - touched > FACT_STALE_DAYS * DAY_MS) {
      archives.push(fact.id);
      changes.push({ kind: "fact", action: "archive", id: fact.id, key: fact.key, note: `unused for over ${FACT_STALE_DAYS} days` });
    }
  }

  return { changes, merges, archives };
}

export async function runCurator(options: CuratorOptions): Promise<MemoryRun> {
  const now = options.now ?? Date.now();
  const startedAt = new Date(now).toISOString();
  const facts = await listActiveFacts("demo-family");
  const playbooks = await listActivePlaybooks();

  const plan = planConsolidation(facts, now);
  const changes: MemoryRunChange[] = [...plan.changes];

  // Stale playbooks archive too — a procedure nobody triggers is noise.
  for (const playbook of playbooks) {
    const touched = Date.parse(String(playbook.lastUsed || playbook.updatedAt || ""));
    if (!Number.isNaN(touched) && now - touched > PLAYBOOK_STALE_DAYS * DAY_MS) {
      changes.push({ kind: "playbook", action: "archive", id: playbook.id, key: playbook.slug, note: `unused for over ${PLAYBOOK_STALE_DAYS} days` });
    }
  }

  const snapshot = {
    facts: facts
      .filter((f) => plan.merges.some((m) => m.dropId === f.id) || plan.archives.includes(f.id))
      .map((f) => ({ ...f })),
    playbooks: playbooks
      .filter((p) => changes.some((c) => c.kind === "playbook" && c.id === p.id))
      .map((p) => ({ ...p })),
  };

  const report = [
    `# Memory cleanup — ${new Date(now).toISOString()}`,
    "",
    changes.length ? changes.map((c) => `- ${c.action} ${c.kind} ${c.key ?? c.id}: ${c.note}`).join("\n") : "- nothing to do",
  ].join("\n");

  if (!options.dryRun && changes.length) {
    const pb = await getAuthedPB();
    for (const fact of snapshot.facts ?? []) {
      await pb.collection("consuela_family_memories").update(fact.id, {
        status: "archived",
        updatedAt: new Date(now).toISOString(),
      }, { requestKey: null }).catch(() => undefined);
    }
    for (const playbook of snapshot.playbooks ?? []) {
      await archivePlaybook(playbook.slug);
    }
  }

  const runId = `run-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
  const finishedAt = new Date(now).toISOString();
  const summary = changes.length
    ? `${changes.length} change(s): ${changes.filter((c) => c.action === "merge").length} merged, ${changes.filter((c) => c.action === "archive").length} archived`
    : "nothing to do";

  let id = "";
  if (!options.dryRun) {
    const pb = await getAuthedPB();
    const row = await pb.collection("consuela_memory_runs").create({
      runId,
      trigger: options.trigger,
      summary,
      changes: JSON.stringify(changes),
      snapshot: JSON.stringify(snapshot),
      report,
      startedAt,
      finishedAt,
    }, { requestKey: null });
    id = String(row?.id ?? "");
  }

  return { id, runId, trigger: options.trigger, summary, changes, snapshot, report, startedAt, finishedAt };
}

export async function undoRun(runId: string): Promise<boolean> {
  try {
    const pb = await getAuthedPB();
    const run = await pb.collection("consuela_memory_runs").getFirstListItem(`runId = "${runId}"`, { requestKey: null });
    const snapshot = typeof run.snapshot === "string" ? JSON.parse(run.snapshot) : (run.snapshot ?? {});
    for (const fact of snapshot.facts ?? []) {
      await pb.collection("consuela_family_memories").update(fact.id, {
        status: "active",
        content: fact.content,
        updatedAt: fact.updatedAt,
      }, { requestKey: null }).catch(() => undefined);
    }
    for (const playbook of snapshot.playbooks ?? []) {
      await pb.collection("consuela_playbooks").update(playbook.id, {
        status: "active",
        updatedAt: playbook.updatedAt,
      }, { requestKey: null }).catch(() => undefined);
    }
    await pb.collection("consuela_memory_runs").update(run.id, {
      undoneAt: new Date().toISOString(),
    }, { requestKey: null });
    return true;
  } catch (error) {
    console.error("Failed to undo memory run:", error);
    return false;
  }
}

export async function listRuns(limit = 20): Promise<MemoryRun[]> {
  try {
    const pb = await getAuthedPB();
    const rows = await pb.collection("consuela_memory_runs").getFullList({
      sort: "-created",
      requestKey: null,
    }) as any[];
    return rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      runId: String(row.runId),
      trigger: String(row.trigger ?? ""),
      summary: String(row.summary ?? ""),
      changes: typeof row.changes === "string" ? JSON.parse(row.changes) : (row.changes ?? []),
      snapshot: typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : (row.snapshot ?? {}),
      report: String(row.report ?? ""),
      startedAt: String(row.startedAt ?? ""),
      finishedAt: String(row.finishedAt ?? ""),
      undoneAt: row.undoneAt ? String(row.undoneAt) : undefined,
    }));
  } catch (error) {
    console.error("Failed to list memory runs:", error);
    return [];
  }
}
