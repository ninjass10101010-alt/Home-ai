#!/usr/bin/env node
// One-time migration of the family memory bank (2026-10-21). Dry-run by
// default: prints the plan and exits. Pass --apply to write.
//
// Load env the way pb-seed.mjs does.
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
try { process.loadEnvFile(path.join(REPO_ROOT, ".env.local")); } catch { /* rely on exported env */ }
const { planMigration } = await import(path.join(REPO_ROOT, "src/lib/memory-migration.ts"));
const { getAuthedPB } = await import(path.join(REPO_ROOT, "src/lib/pb-auth.ts"));

const APPLY = process.argv.includes("--apply");
const pb = await getAuthedPB();
const rows = await pb.collection("consuela_family_memories").getFullList({ requestKey: null });
const plan = planMigration(rows.map((r: any) => ({
  id: r.id,
  key: r.key,
  category: r.category,
  content: r.content,
  tags: typeof r.tags === "string" ? r.tags : JSON.stringify(r.tags ?? []),
})));

console.log(`Plan: ${plan.facts.length} facts, ${plan.playbooks.length} playbooks, ${plan.archived.length} archived.`);
if (!APPLY) {
  console.log("Dry run — pass --apply to write. No changes made.");
  process.exit(0);
}

// apply: write facts, playbooks, archive the folded rows, write the run row
for (const fact of plan.facts) {
  const existing = rows.find((r: any) => r.id === fact.id);
  if (existing && existing.key === fact.key) continue; // idempotent
  await pb.collection("consuela_family_memories").update(fact.id, {
    key: fact.key, person: fact.person, scope: fact.scope, status: "active", version: 1,
  }, { requestKey: null });
}
for (const playbook of plan.playbooks) {
  await pb.collection("consuela_playbooks").create({
    slug: playbook.slug, title: playbook.title, domain: playbook.domain,
    trigger: playbook.trigger, body: playbook.body, version: 1, status: "active",
    history: JSON.stringify([]), useCount: 0, createdBy: "migration",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, { requestKey: null }).catch(() => undefined);
}
for (const archived of plan.archived) {
  await pb.collection("consuela_family_memories").update(archived.id, { status: "archived" }, { requestKey: null }).catch(() => undefined);
}
await pb.collection("consuela_memory_runs").create({
  runId: `migration-${new Date().toISOString()}`,
  trigger: "migration",
  summary: `${plan.facts.length} facts, ${plan.playbooks.length} playbooks, ${plan.archived.length} archived`,
  changes: JSON.stringify(plan.archived.map((a) => ({ kind: "fact", action: "archive", id: a.id, note: a.reason }))),
  snapshot: JSON.stringify({ facts: rows, playbooks: [] }),
  report: "one-time migration to subject keys",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
}, { requestKey: null }).catch(() => undefined);
console.log("Applied.");
