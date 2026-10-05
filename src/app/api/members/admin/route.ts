import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { createMemberRecord, findLiveMemberByExactName, findLiveMemberById, isMemberPinAvailable, listLiveMembersSanitized, listMembersSanitized, sanitizeMember, withMemberAdminOperation } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { normalizeWeekStart } from "@/lib/ledger-operations";
import { migrateWeekDataMemberName } from "@/lib/task-ledger";
import { mutateSnapshotWithMeta, normalizeWeekData, readSnapshotStateWithRevision, type AdminPB } from "@/lib/snapshot-tasks";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import type { WeekData } from "@/types/tasks";

export const dynamic = "force-dynamic";

const ALLOWED_MEMBER_ROLES = new Set(["parent", "child", "pet"]);

/** Every collection the points ledger is keyed by member name in. */
const LEDGER_WEEK_COLLECTIONS = ["week_data", "week_archive"] as const;

type Row = Record<string, any>;

type RenameOutcome =
  | { ok: true; weeks: string[]; warnings: string[] }
  | { ok: false; status: number; error: string };

interface WeekRowGroup {
  collection: typeof LEDGER_WEEK_COLLECTIONS[number];
  weekStart: string;
  rows: Row[];
}

function normalizedMemberName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function weekPayload(week: WeekData, row: Row): Row {
  return {
    weekStart: week.weekStart,
    points: week.points,
    streak: week.streak,
    lastActive: week.lastActive,
    history: week.history,
    // `week_archive` owns the freeze stamp; never drop it on a field write.
    ...(typeof row.archivedAt === "string" && row.archivedAt ? { archivedAt: row.archivedAt } : {}),
  };
}

function sortedRecord(record: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedHistory(history: readonly Row[]): Row[] {
  return history
    .map((transaction) => ({
      id: transaction?.id,
      timestamp: transaction?.timestamp,
      member: transaction?.member,
      type: transaction?.type,
      amount: transaction?.amount,
      description: transaction?.description,
      taskId: transaction?.taskId ?? null,
      appliedBy: transaction?.appliedBy ?? null,
      operationId: transaction?.meta?.operationId ?? null,
    }))
    .sort((left, right) => left.id - right.id);
}

/** Deep comparison over a WEEK's canonical content, independent of key order. */
function sameWeek(left: WeekData | null, right: WeekData | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.weekStart === right.weekStart &&
    JSON.stringify(sortedRecord(left.points)) === JSON.stringify(sortedRecord(right.points)) &&
    JSON.stringify(sortedRecord(left.streak)) === JSON.stringify(sortedRecord(right.streak)) &&
    JSON.stringify(sortedRecord(left.lastActive)) === JSON.stringify(sortedRecord(right.lastActive)) &&
    JSON.stringify(sortedHistory(left.history)) === JSON.stringify(sortedHistory(right.history))
  );
}

async function readWeekRowGroups(pb: AdminPB): Promise<WeekRowGroup[]> {
  const groups: WeekRowGroup[] = [];
  for (const collection of LEDGER_WEEK_COLLECTIONS) {
    const rows = await pb.collection(collection).getFullList({ requestKey: null });
    if (!Array.isArray(rows)) throw new Error("ledger_read_failed");
    const byWeek = new Map<string, Row[]>();
    for (const row of rows as Row[]) {
      const weekStart = normalizeWeekStart(row?.weekStart);
      // A row with no resolvable week key is not addressable by week, so it is
      // left exactly as it is (the reconciler already reports it).
      if (!weekStart) continue;
      byWeek.set(weekStart, [...(byWeek.get(weekStart) ?? []), row]);
    }
    for (const [weekStart, weekRows] of byWeek) {
      groups.push({
        collection,
        weekStart,
        rows: weekRows.sort((left, right) => String(left.id).localeCompare(String(right.id))),
      });
    }
  }
  // A stable order keeps the lock acquisition order (and the rollback order)
  // deterministic.
  return groups.sort((left, right) =>
    left.weekStart.localeCompare(right.weekStart) ||
    left.collection.localeCompare(right.collection));
}

/**
 * Move every ledger key for one member from `from` to `to`, one week at a time.
 *
 * All-or-nothing PER WEEK: a week's rows are written from a fully-prepared
 * payload and then verified against a fresh read; if a write is rejected, or
 * PocketBase silently drops it, or the verification disagrees, every row of
 * that week is restored to the exact payload it had before this function
 * touched it. A week therefore never ends up holding half its history under
 * the old name and half under the new one — which would read as a SUM OF TWO
 * PARTIAL HISTORIES, strictly worse than doing nothing.
 *
 * And all-or-nothing for the RENAME: if any week fails, the weeks already
 * migrated are migrated back. The migration is a pure function of the stored
 * row and is idempotent in both directions, so the rollback is the same code
 * path with the names swapped — and a re-run of the whole rename converges.
 *
 * Each week is migrated while HOLDING its own week-ledger lock, so no claim,
 * approval or completion can interleave a read-modify-write into the same week.
 * The week keys are the stored rows' own keys: this derives no date.
 */
async function migrateWeekGroup(
  pb: AdminPB,
  group: WeekRowGroup,
  from: string,
  to: string,
): Promise<{ status: "migrated" | "unchanged" | "conflict" }> {
  return withWeekLedgerLock(group.weekStart, async () => {
    const rows = (await pb.collection(group.collection).getFullList({ requestKey: null }) as Row[])
      .filter((row) => normalizeWeekStart(row?.weekStart) === group.weekStart)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const writes: { row: Row; original: WeekData; next: WeekData }[] = [];
    for (const row of rows) {
      const week = normalizeWeekData(row);
      // A week whose stored history no longer parses asserts nothing about any
      // member name (every balance runs the same canonical parser), so there is
      // nothing here to migrate and nothing to corrupt.
      if (!week) continue;
      const outcome = migrateWeekDataMemberName(week, from, to);
      if (outcome.status === "conflict") return { status: "conflict" };
      if (outcome.status !== "migrated") continue;
      writes.push({ row, original: week, next: outcome.week });
    }
    if (writes.length === 0) return { status: "unchanged" };

    const restore = async (): Promise<void> => {
      for (const write of [...writes].reverse()) {
        try {
          await pb.collection(group.collection).update(write.row.id, weekPayload(write.original, write.row), { requestKey: null });
        } catch {
          // A failed restore is reported by the caller's honest error; there is
          // nothing further this process can do for this week.
        }
      }
    };

    for (const write of writes) {
      try {
        await pb.collection(group.collection).update(write.row.id, weekPayload(write.next, write.row), { requestKey: null });
      } catch {
        await restore();
        throw new Error("ledger_rename_failed");
      }
    }
    const verifiedRows = (await pb.collection(group.collection).getFullList({ requestKey: null }) as Row[])
      .filter((row) => normalizeWeekStart(row?.weekStart) === group.weekStart);
    const verified = writes.every((write) =>
      verifiedRows.some((row) => String(row.id) === String(write.row.id) && sameWeek(normalizeWeekData(row), write.next)));
    if (!verified) {
      await restore();
      throw new Error("ledger_rename_failed");
    }
    return { status: "migrated" };
  });
}

/**
 * B1 — a rename must carry its ledger history with it.
 *
 * The ledger is keyed on the member's mutable DISPLAY NAME. Rewriting `name`
 * on the roster row alone orphans the balance: `history[].member`, `points`,
 * `streak` and `lastActive` keep the old key, every lookup by the new name
 * reads `undefined`, and `recomputeWeekPoints` floors at 0 — so the child shows
 * 0 while the negative-balance gate, which can only see a key that EXISTS,
 * sees no deficit and lets a penalty push them below their real balance.
 */
async function renameMemberLedgerKeys(from: string, to: string): Promise<RenameOutcome> {
  if (!from || !to || from === to) return { ok: true, weeks: [], warnings: [] };
  try {
    return await withAdmin(async (pb): Promise<RenameOutcome> => {
      const groups = await readWeekRowGroups(pb);

      // Refuse BEFORE the first write when the target name already has ledger
      // history: renaming onto it would merge two people's balances into one.
      for (const group of groups) {
        for (const row of group.rows) {
          const week = normalizeWeekData(row);
          if (!week) continue;
          if (migrateWeekDataMemberName(week, from, to).status === "conflict") {
            return { ok: false, status: 409, error: "ledger_name_conflict" };
          }
        }
      }

      const warnings: string[] = [];
      const migrated: WeekRowGroup[] = [];
      try {
        for (const group of groups) {
          const outcome = await migrateWeekGroup(pb, group, from, to);
          if (outcome.status === "conflict") {
            await rollback(pb, migrated, to, from);
            return { ok: false, status: 409, error: "ledger_name_conflict" };
          }
          if (outcome.status === "migrated") migrated.push(group);
        }
      } catch {
        // The failing week was already restored by `migrateWeekGroup`; put the
        // weeks this rename DID move back, so the rename is all-or-nothing
        // rather than half-applied across weeks.
        await rollback(pb, migrated, to, from);
        return { ok: false, status: 500, error: "ledger_rename_failed" };
      }

      // The snapshot mirrors the current week; it self-heals from `week_data`
      // on the next reconcile, but a rename that leaves it keyed under the old
      // name is exactly the orphan this bug is about. It is read first so an
      // unnecessary write (which bumps the snapshot revision and can trip a
      // concurrent pass's `rollover:changed`) never happens.
      const snapshotStatus = await migrateSnapshotWeekKeys(pb, from, to);
      if (snapshotStatus === "conflict") {
        await rollback(pb, migrated, to, from);
        return { ok: false, status: 409, error: "ledger_name_conflict" };
      }
      if (snapshotStatus === "unavailable") {
        await rollback(pb, migrated, to, from);
        return { ok: false, status: 500, error: "ledger_rename_failed" };
      }
      for (const group of groups) {
        if (migrated.includes(group)) continue;
        if (group.rows.some((row) => !normalizeWeekData(row))) {
          warnings.push(`week:${group.weekStart}:${group.collection}:unreadable`);
        }
      }
      return {
        ok: true,
        weeks: migrated.map((group) => `${group.collection}:${group.weekStart}`),
        warnings,
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ledger_name_conflict") {
      return { ok: false, status: 409, error: "ledger_name_conflict" };
    }
    return { ok: false, status: 500, error: "ledger_rename_failed" };
  }
}

/**
 * Move the member's keys inside the snapshot's mirrored `weekData`, writing
 * ONLY when there is something to move.
 */
async function migrateSnapshotWeekKeys(
  pb: AdminPB,
  from: string,
  to: string,
): Promise<"migrated" | "unchanged" | "conflict" | "unavailable"> {
  try {
    const stored = normalizeWeekData(
      (await readSnapshotStateWithRevision(pb)).data.weekData,
    );
    if (!stored) return "unchanged";
    const planned = migrateWeekDataMemberName(stored, from, to);
    if (planned.status === "conflict") return "conflict";
    if (planned.status !== "migrated") return "unchanged";
    const mutation = await mutateSnapshotWithMeta<{ status: string }>((data) => {
      const week = normalizeWeekData(data.weekData);
      if (!week) return { data, result: { status: "unchanged" } };
      const outcome = migrateWeekDataMemberName(week, from, to);
      if (outcome.status !== "migrated") return { data, result: { status: outcome.status } };
      return { data: { ...data, weekData: outcome.week }, result: { status: "migrated" } };
    }, pb);
    return mutation.result?.status === "conflict" ? "conflict" : "migrated";
  } catch {
    return "unavailable";
  }
}

/** Undo the weeks this rename already migrated, best effort. */
async function rollback(
  pb: AdminPB,
  groups: readonly WeekRowGroup[],
  from: string,
  to: string,
): Promise<void> {
  for (const group of [...groups].reverse()) {
    try {
      await migrateWeekGroup(pb, group, from, to);
    } catch {
      // Idempotent in both directions: the next rename attempt converges.
    }
  }
}

/**
 * Whole-ledger reverse sweep, used when the roster write itself failed after
 * the keys had already moved.
 */
async function rollbackLedgerKeys(pb: AdminPB, from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  try {
    const groups = await readWeekRowGroups(pb);
    await rollback(pb, groups, from, to);
  } catch {
    // Best effort only: the caller is already returning an honest failure.
  }
  await migrateSnapshotWeekKeys(pb, from, to);
}

// Members admin surface for Settings → Family Members, replacing the old
// client-direct PB writes (db.insertMember / db.updateMember / db.deleteMember)
// that broke once PB rules locked down and that were insecure anyway.
//
//   GET    — any VALID SESSION (adult or child): read-only sanitized roster.
//   POST   — adults only: create a member with a server-resolved PIN. Exact
//            normalized full-name duplicates return 409 {error:"duplicate"}.
//   PATCH  — adults only: update an exact live PB ID; normalized duplicate
//            names are rejected before mutation. A `name` change is a LEDGER
//            operation, not a label: every week row's member-keyed fields
//            (`history[].member`, `points`, `streak`, `lastActive`) in
//            `week_data` + `week_archive` and the snapshot's mirrored
//            `weekData` move to the new name with it, all-or-nothing per week.
//            A target name that already holds ledger history is refused with
//            409 {error:"ledger_name_conflict"} rather than merged.
//   DELETE — adults only by exact live PB ID; refuses to delete the last
//            parent-role member.

export async function GET(request: NextRequest) {
  try {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const source = request.nextUrl.searchParams.get("source");
    if (source === "live") {
      const members = await listLiveMembersSanitized();
      return NextResponse.json({ members, source: "live" });
    }
    const members = await listMembersSanitized();
    return NextResponse.json({ members });
  } catch (error) {
    console.error("Members admin GET error:", error);
    return NextResponse.json({ error: "Failed to list members" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const body = await request.json();
    if (!body || typeof body !== "object" || !body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof body.role !== "string" || !ALLOWED_MEMBER_ROLES.has(body.role)) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    const member = await createMemberRecord(body);
    if (!member) {
      return NextResponse.json({ error: "duplicate" }, { status: 409 });
    }
    const starterPin = typeof member.pin === "string" && /^\d{4}$/.test(member.pin)
      ? member.pin
      : undefined;
    return NextResponse.json({
      member: sanitizeMember(member),
      ...(starterPin ? { starterPin } : {}),
    }, { status: 201 });
  } catch (error) {
    console.error("Members admin POST error:", error);
    return NextResponse.json({ error: "Failed to create member" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const { id, name, patch } = await request.json();
    if ((!id && !name) || !patch || typeof patch !== "object") {
      return NextResponse.json({ error: "id and patch are required" }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "role") && !ALLOWED_MEMBER_ROLES.has(patch.role)) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    let renameFrom = "";
    let renameTo = "";
    return withMemberAdminOperation(async () => {
      const member = typeof id === "string"
        ? await findLiveMemberById(id)
        : await findLiveMemberByExactName(typeof name === "string" ? name : undefined);
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        if (typeof patch.name !== "string" || !patch.name.trim()) {
          return NextResponse.json({ error: "invalid_name" }, { status: 400 });
        }
        const nextName = patch.name.trim().replace(/\s+/g, " ");
        const duplicate = await withAdmin(async (pb) => {
          const records = await pb.collection("members").getFullList({ requestKey: null });
          return records.some((row: any) => String(row.id) !== String(member.id) && normalizedMemberName(row.name) === normalizedMemberName(nextName));
        });
        if (duplicate) return NextResponse.json({ error: "duplicate" }, { status: 409 });
        renameFrom = String(member.name ?? "").trim();
        renameTo = nextName;
        patch.name = nextName;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "pin")) {
        if (typeof patch.pin !== "string") {
          return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
        }
        if (!patch.pin.trim()) {
          delete patch.pin;
        } else if (!/^\d{4}$/.test(patch.pin)) {
          return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
        } else if (!await isMemberPinAvailable(patch.pin, member.id)) {
          return NextResponse.json({ error: "pin_collision" }, { status: 409 });
        }
      }
      const nextRole = typeof patch.role === "string" ? patch.role.toLowerCase() : String(member.role || "").toLowerCase();
      if (nextRole !== "parent" && String(member.role || "").toLowerCase() === "parent") {
        const liveMembers = await listLiveMembersSanitized();
        if (liveMembers.filter((m: any) => String(m.role || "").toLowerCase() === "parent").length <= 1) {
          return NextResponse.json({ error: "last_parent" }, { status: 400 });
        }
      }
      // Every other validation has passed, so this really is a rename. A rename
      // is a LEDGER operation, not a label change — the ledger is keyed on this
      // name — so the keys are migrated FIRST, and a week that cannot be
      // migrated atomically refuses the whole rename. The roster can therefore
      // never end up pointing at a balance orphaned under the old name.
      const renaming = renameTo.length > 0 && renameTo !== renameFrom;
      if (renaming) {
        const migration = await renameMemberLedgerKeys(renameFrom, renameTo);
        if (!migration.ok) {
          return NextResponse.json({ error: migration.error }, { status: migration.status });
        }
      }
      const updated = await withAdmin((pb) => pb.collection("members").update(member.id, patch));
      if (renaming && (!updated || String((updated as Row).name ?? "") !== renameTo)) {
        // The roster never took the new name, so the migrated keys would be the
        // orphan in the other direction: put them back before reporting.
        await withAdmin((pb) => rollbackLedgerKeys(pb, renameTo, renameFrom));
        return NextResponse.json({ error: "rename_incomplete" }, { status: 500 });
      }
      return NextResponse.json({ member: sanitizeMember(updated ?? member) });
    });
  } catch (error) {
    console.error("Members admin PATCH error:", error);
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const { id, name } = await request.json();
    if (!id && !name) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    return withMemberAdminOperation(async () => {
      const member = typeof id === "string"
        ? await findLiveMemberById(id)
        : await findLiveMemberByExactName(typeof name === "string" ? name : undefined);
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (String(member.role || "").toLowerCase() === "parent") {
        const all = await listLiveMembersSanitized();
        if (all.filter((m: any) => String(m.role || "").toLowerCase() === "parent").length <= 1) {
          return NextResponse.json({ error: "last_parent" }, { status: 400 });
        }
      }
      await withAdmin((pb) => pb.collection("members").delete(member.id));
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error("Members admin DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete member" }, { status: 500 });
  }
}
