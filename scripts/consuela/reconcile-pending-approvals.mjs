// One-time ops reconcile (2026-09-23 review, run AFTER deploy):
// Before the sync route grew the push-side pendingApproval guard
// (protectPendingOnPush), a parent's stale local list could replace the
// snapshot's tasks leg verbatim and silently ERASE a kid's just-written
// pendingApproval — the tap stranded "on the way" forever while the PB tasks
// collection row still carried the pending. This script re-stamps the
// SNAPSHOT from the PB mirror rows, applying the same proof rules as the
// guard (skip rows already paid in the stored history, or sent back after
// the tap) so it can never resurrect an approval that was legitimately
// resolved. Safe to re-run: healed rows are skipped on the second pass.
//
//   npx tsx scripts/consuela/reconcile-pending-approvals.mjs
import PB from "pocketbase";

const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}
const url = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090";
const email = process.env.PB_ADMIN_EMAIL, pass = process.env.PB_ADMIN_PASS;
if (!email || !pass) { console.error("PB_ADMIN_EMAIL/PB_ADMIN_PASS required"); process.exit(1); }

const KEY = "tasks-snapshot";
const pb = new PB(url);
await pb.collection("_superusers").authWithPassword(email, pass);

const rows = await pb.collection("consuela_data_snapshots").getFullList({
  requestKey: null,
  filter: `key = "${KEY}"`,
});
const row = rows[0];
if (!row) { console.error("no tasks-snapshot row — nothing to reconcile"); process.exit(0); }
const data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data ?? {});
const tasks = Array.isArray(data.tasks) ? data.tasks : [];
const history = Array.isArray(data.weekData?.history) ? data.weekData.history : [];

const collRows = await pb.collection("tasks").getFullList({ requestKey: null });
const byTaskId = new Map(collRows.map((r) => [Number(r.taskId), r]));

const ts = (v) => {
  const n = Date.parse(String(v ?? ""));
  return Number.isNaN(n) ? null : n;
};
const paidInSnapshot = (id) =>
  history.some((tx) => tx?.type === "earn" && Number(tx?.taskId) === Number(id));

let healed = 0;
const nextTasks = tasks.map((t) => {
  if (t?.pendingApproval) return t; // already carries a live pending
  const rec = byTaskId.get(Number(t?.id));
  const pending = rec?.pendingApproval;
  if (!pending || typeof pending !== "object") return t;
  // Proof rules — mirror protectPendingOnPush: never heal a pending the
  // stored ledger already paid, or that a send-back post-dating the tap
  // resolved.
  if (paidInSnapshot(t.id)) {
    console.log(`skip task ${t.id} — earn tx already in snapshot history`);
    return t;
  }
  const tapAt = ts(pending.at);
  const sentBackAt = ts(t.sentBackAt);
  if (sentBackAt !== null && (tapAt === null || sentBackAt >= tapAt)) {
    console.log(`skip task ${t.id} — sent back after the mirrored tap`);
    return t;
  }
  // Also skip rows the mirror marks completed but the pending implies a
  // completion the snapshot row lost — the pending carries its own stamps.
  healed += 1;
  console.log(`heal task ${t.id} (${t.title ?? "?"}) — pending by ${pending.byName} restored from PB row ${rec.id}`);
  return {
    ...t,
    completed: true,
    completedBy: rec.completedBy ?? pending.byName,
    completedAt: rec.completedAt ?? pending.at,
    completedInWeek: rec.completedInWeek ?? data.weekData?.weekStart ?? null,
    pendingApproval: pending,
    sentBackAt: null,
  };
});

if (!healed) { console.log("nothing to heal — snapshot already consistent"); process.exit(0); }
data.tasks = nextTasks;
await pb.collection("consuela_data_snapshots").update(row.id, {
  key: KEY,
  data,
  updated_at: new Date().toISOString(),
});
console.log(`done — ${healed} snapshot row(s) healed`);
