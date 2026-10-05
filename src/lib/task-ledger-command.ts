import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import { applyWeekLedgerOperationLocked } from "@/lib/ledger-operations";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { emptyWeekData } from "@/lib/task-utils";
import { getLiveMembers } from "@/lib/live-member";
import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import {
  mutateSnapshotWithMeta,
  readSnapshotStateWithRevision,
  type AdminPB,
  type SnapshotData,
  type SnapshotRevision,
} from "@/lib/snapshot-tasks";
import { sanitizeTaskConfigItems, type PenaltyConfigItem } from "@/lib/task-config";
import { textEmoji } from "@/lib/consuela/live-reads";
import type { LedgerEntryInput, WeekData } from "@/types/tasks";

export type LedgerCommandAction = "penalty" | "adjust";

export interface LedgerCommand {
  operationId: string;
  action: LedgerCommandAction;
  /**
   * The ACTOR: the member whose PIN this command presents. It is authenticated
   * and its live role is required to be `parent` before anything is written. It
   * is NOT who the points move.
   */
  memberName: string;
  /**
   * The TARGET: the member whose balance actually moves. Optional, and it
   * defaults to the actor, so a same-member command is unchanged — but a parent
   * moving a child's points is the ordinary case and needs the two identities
   * kept apart.
   */
  targetMemberName?: string;
  memberId: string;
  pin: string;
  itemId?: string | number;
  points?: number;
  amount?: number;
  reason?: string;
}

export type LedgerFailureReason =
  | "invalid_body"
  | "invalid_action"
  | "unknown_member"
  | "pet_target"
  | "unauthorized"
  | "adult_only"
  | "unknown_penalty"
  | "invalid_task_state"
  | "insufficient_balance"
  | "operation_conflict"
  | "ledger_unavailable"
  | "member_roster_unavailable"
  | "snapshot_write_failed";

export interface LedgerCommandResult {
  ok: boolean;
  operationId: string;
  action: LedgerCommandAction;
  reason?: LedgerFailureReason;
  weekData: WeekData;
  applied: number;
  member: string;
  points: number;
  weekStart: string;
  reconciled: boolean;
  repairRequired: boolean;
  duplicate: boolean;
  revision?: SnapshotRevision;
}

export interface ParseLedgerCommandResult {
  ok: true;
  command: Omit<LedgerCommand, "memberId">;
}

export interface ParseLedgerCommandError {
  ok: false;
  reason: LedgerFailureReason;
  operationId: string;
}

const ACTIONS = new Set<string>(["penalty", "adjust"]);

const MAX_AMOUNT = 10_000;
const MAX_REASON_LENGTH = 120;

function signedAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value.trim().slice(0, MAX_REASON_LENGTH) : undefined;
}

function optionalId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/**
 * The wire contract for POST /api/tasks/ledger. A `penalty` carries a CATALOG
 * item id (never a client-chosen point value — the server reads the canonical
 * penalty from the config snapshot); an `adjust` carries an explicit amount and
 * an optional reason. Authority fields (`points` on a penalty, the balance, the
 * resulting week) are refused rather than ignored.
 *
 * `memberName` is the PIN-VERIFIED ACTOR and `targetMemberName` is the member
 * whose balance moves; the target is OPTIONAL and defaults to the actor, so a
 * same-member call parses to exactly the command it always did. A target that is
 * present but names nobody is refused outright — silently falling back to the
 * actor would move a real family's points to the wrong person.
 */
export function parseLedgerCommand(value: unknown): ParseLedgerCommandResult | ParseLedgerCommandError {
  if (!isRecord(value)) {
    return { ok: false, reason: "invalid_body", operationId: "" };
  }
  const operationId = normalizeOperationId(value.operationId);
  if (!operationId) {
    return { ok: false, reason: "invalid_body", operationId: "" };
  }
  const action = typeof value.action === "string" ? value.action.trim() : "";
  if (!ACTIONS.has(action)) {
    return { ok: false, reason: "invalid_action", operationId };
  }
  const memberName = typeof value.memberName === "string" ? value.memberName.trim() : "";
  if (!memberName) {
    return { ok: false, reason: "invalid_body", operationId };
  }
  const pin = typeof value.pin === "string" ? value.pin.trim() : "";
  if (!pin) {
    return { ok: false, reason: "unauthorized", operationId };
  }
  // Absent or null target = "the actor is the target" (the pre-split shape, so
  // the key never appears on the command). Anything else must name somebody.
  let targetMemberName: string | undefined;
  if (value.targetMemberName !== undefined && value.targetMemberName !== null) {
    const requested = typeof value.targetMemberName === "string"
      ? value.targetMemberName.trim()
      : "";
    if (!requested) {
      return { ok: false, reason: "invalid_body", operationId };
    }
    targetMemberName = requested;
  }
  // A penalty's POINTS are never a client input: the catalog leg decides them.
  // An adjust's amount may be signed (a deduction is an adjust too); the
  // non-negative BALANCE is the ledger helper's job, not the parser's.
  if (
    value.points !== undefined ||
    (value.itemId !== undefined && action !== "penalty") ||
    (value.amount !== undefined && action !== "adjust") ||
    (value.reason !== undefined && action !== "adjust")
  ) {
    return { ok: false, reason: "invalid_body", operationId };
  }

  if (action === "penalty") {
    const itemId = optionalId(value.itemId);
    if (!itemId) return { ok: false, reason: "invalid_body", operationId };
    return {
      ok: true,
      command: {
        operationId,
        action,
        memberName,
        ...(targetMemberName !== undefined ? { targetMemberName } : {}),
        pin,
        itemId,
      },
    };
  }

  const amount = value.amount;
  if (!signedAmount(amount)) {
    return { ok: false, reason: "invalid_task_state", operationId };
  }
  const reason = optionalText(value.reason) ?? "";
  return {
    ok: true,
    command: {
      operationId,
      action: action as LedgerCommandAction,
      memberName,
      ...(targetMemberName !== undefined ? { targetMemberName } : {}),
      pin,
      amount,
      reason,
    },
  };
}

/**
 * The movement's identity, so a replayed `operationId` is recognised and a
 * reused one against a DIFFERENT movement is a conflict. `member` is the TARGET
 * (the balance that moves); the author is already pinned by `actorId`. For a
 * command with no explicit target this is byte-for-byte the pre-split value, so
 * an in-flight replay across a deploy still matches its own receipt.
 */
function ledgerCommandFingerprint(command: LedgerCommand): string {
  const targetName = command.targetMemberName?.trim() || command.memberName;
  return createHash("sha256")
    .update(JSON.stringify({
      action: command.action,
      member: targetName,
      actorId: command.memberId,
      ...(command.itemId !== undefined ? { itemId: String(command.itemId) } : {}),
      ...(command.amount !== undefined ? { amount: command.amount } : {}),
      ...(command.reason !== undefined ? { reason: command.reason } : {}),
    }))
    .digest("hex");
}

interface ResolvedRosterMember {
  id: string;
  fullName: string;
  role: string;
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolveMember(roster: ResolvedRosterMember[], requested: string): ResolvedRosterMember | null {
  const exact = roster.find((member) => sameName(member.fullName, requested));
  if (exact) return exact;
  const first = requested.trim().split(" ")[0].toLowerCase();
  const matches = roster.filter((member) => member.fullName.trim().split(" ")[0].toLowerCase() === first);
  return matches.length === 1 ? matches[0] : null;
}

interface ResolvedEntry {
  entries: LedgerEntryInput[];
  amount: number;
  member: string;
  description: string;
}

function penaltyEntry(
  command: LedgerCommand,
  member: ResolvedRosterMember,
  penalty: PenaltyConfigItem,
): ResolvedEntry {
  const points = penalty.points;
  return {
    entries: [{
      type: "penalty",
      member: member.fullName,
      amount: -points,
      description: `Penalty: ${penalty.name} (-${points}pts)`,
      appliedBy: command.memberId,
    }],
    amount: -points,
    member: member.fullName,
    description: `Penalty: ${penalty.name}`,
  };
}

function adjustEntry(
  command: LedgerCommand,
  member: ResolvedRosterMember,
): ResolvedEntry {
  const amount = command.amount as number;
  const reason = command.reason ? ` (${command.reason})` : "";
  return {
    entries: [{
      type: "adjust",
      member: member.fullName,
      amount,
      description: `Manual adjust: ${amount > 0 ? "+" : ""}${amount}pts${reason}`,
      appliedBy: command.memberId,
    }],
    amount,
    member: member.fullName,
    description: `Manual adjust: ${amount > 0 ? "+" : ""}${amount}pts`,
  };
}

function failure(
  operationId: string,
  action: LedgerCommandAction,
  reason: LedgerFailureReason,
  week: WeekData,
  partial?: { member?: string; points?: number; reconciled?: boolean; revision?: SnapshotRevision },
): LedgerCommandResult {
  return {
    ok: false,
    operationId,
    action,
    reason,
    weekData: week,
    applied: 0,
    member: partial?.member ?? "",
    points: partial?.points ?? 0,
    weekStart: week.weekStart,
    reconciled: partial?.reconciled ?? true,
    repairRequired: false,
    duplicate: false,
    ...(partial?.revision ? { revision: partial.revision } : {}),
  };
}

function withRepairMarker(
  data: SnapshotData,
  operationId: string,
  action: LedgerCommandAction,
  actorId: string,
  fingerprint: string,
): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  const next = current.filter((marker) => marker.operationId !== operationId);
  next.push({
    operationId,
    taskIds: [],
    action,
    actorId,
    fingerprint,
    createdAt: new Date().toISOString(),
  } as NonNullable<SnapshotData["pendingProjectionRepairs"]>[number]);
  return { ...data, pendingProjectionRepairs: next };
}

/**
 * The canonical penalty comes from the CONFIG SNAPSHOT leg, never from the
 * command body: a client that asks for "100 points" gets the catalog value or
 * nothing. Reading through the same sanitizer the config route writes with
 * keeps the two surfaces from disagreeing about what a penalty is.
 */
async function readCatalogPenalty(pb: AdminPB, itemId: string): Promise<PenaltyConfigItem | null> {
  const state = await readSnapshotStateWithRevision(pb);
  const stored = state.data.penalties;
  const items = Array.isArray(stored)
    ? sanitizeTaskConfigItems("penalties", stored, textEmoji) as PenaltyConfigItem[] | null
    : null;
  if (!items) return null;
  return items.find((item) => String(item.id) === itemId) ?? null;
}

/**
 * The one server-authoritative path for a PARENT point movement that is not a
 * task completion: a catalog penalty and a manual adjust. It reuses the same
 * locked ledger helper the approval command uses, so operationId replay,
 * fingerprints, non-negative balances, the snapshot projection and the repair
 * marker all behave identically to an approval.
 *
 * The AUTHOR and the SUBJECT are separate: `memberId` is the live parent whose
 * PIN was verified (it is written as `appliedBy` / `actorId` for the audit
 * trail), while the balance that moves belongs to the TARGET, resolved here from
 * the live roster rather than from the actor's identity.
 */
export async function executeLedgerCommand(command: LedgerCommand): Promise<LedgerCommandResult> {
  let roster: ResolvedRosterMember[];
  try {
    roster = (await getLiveMembers())
      .map((member) => ({ id: member.id, fullName: member.name, role: member.role }));
  } catch {
    // A roster we could not read is an OUTAGE, not a refusal: the family must be
    // able to tell "Consuela is unreachable, try again" from "that PIN is wrong".
    return failure(command.operationId, command.action, "member_roster_unavailable", emptyWeekData());
  }

  let weekStart: string;
  try {
    const rollover = await ensureCurrentTaskWeek();
    const canonical = typeof rollover.weekStart === "string" ? rollover.weekStart.trim() : "";
    if (!rollover.reconciled || !canonical) {
      return failure(command.operationId, command.action, "ledger_unavailable", emptyWeekData());
    }
    weekStart = canonical;
  } catch {
    return failure(command.operationId, command.action, "ledger_unavailable", emptyWeekData());
  }

  // The target defaults to the actor, so an existing same-member command lands
  // on exactly the member it always did.
  const requestedTarget = command.targetMemberName?.trim() || command.memberName;
  const target = resolveMember(roster, requestedTarget);
  if (!target) {
    // Never a silent fallback to the actor: an unknown name moves NO points.
    return failure(command.operationId, command.action, "unknown_member", emptyWeekData(weekStart));
  }
  if (target.role === "pet") {
    // A pet is on the roster but can never hold points. Reporting it as an
    // unknown member would be a lie about a name the family can see.
    return failure(command.operationId, command.action, "pet_target", emptyWeekData(weekStart));
  }

  let resolved: ResolvedEntry | null = null;
  try {
    resolved = await withAdmin(async (pb): Promise<ResolvedEntry | null> => {
      if (command.action === "penalty") {
        const penalty = await readCatalogPenalty(pb, command.itemId as string);
        if (!penalty || !("points" in penalty)) return null;
        return penaltyEntry(command, target, penalty);
      }
      return adjustEntry(command, target);
    });
  } catch {
    return failure(
      command.operationId,
      command.action,
      "ledger_unavailable",
      emptyWeekData(weekStart),
      { member: target.fullName },
    );
  }
  if (!resolved) {
    return failure(
      command.operationId,
      command.action,
      "unknown_penalty",
      emptyWeekData(weekStart),
      { member: target.fullName },
    );
  }

  const fingerprint = ledgerCommandFingerprint(command);
  const source = command.action === "penalty" ? "task-penalty" : "manual-adjust";

  return withWeekLedgerLock(weekStart, () => withAdmin(async (pb) => {
    let repairRequired = false;
    const result = await applyWeekLedgerOperationLocked({
      weekStart,
      operation: {
        operationId: command.operationId,
        source,
        fingerprint,
        actorId: command.memberId,
        action: command.action,
        entries: resolved.entries,
      },
      project: async ({ weekData }) => {
        try {
          const projected = await mutateSnapshotWithMeta((data) => ({
            data: { ...data, weekData },
            result: null,
          }), pb);
          return Boolean(projected);
        } catch {
          try {
            await mutateSnapshotWithMeta((data) => ({
              data: withRepairMarker(data, command.operationId, command.action, command.memberId, fingerprint),
              result: null,
            }), pb);
          } catch {
            /* the marker is best effort — the reconciler still sees the gap */
          }
          repairRequired = true;
          return false;
        }
      },
    });

    if (!result.ok) {
      const reason: LedgerFailureReason = result.code === "insufficient_balance"
        ? "insufficient_balance"
        : result.code === "operation_conflict"
          ? "operation_conflict"
          : "ledger_unavailable";
      return failure(command.operationId, command.action, reason, result.weekData, {
        member: resolved.member,
        points: result.weekData.points[resolved.member] ?? 0,
      });
    }

    let revision: SnapshotRevision | undefined;
    try {
      revision = (await readSnapshotStateWithRevision(pb)).revision;
    } catch {
      revision = undefined;
    }

    return {
      ok: true,
      operationId: result.operationId,
      action: command.action,
      weekData: result.weekData,
      // The locked helper replays the whole operation or nothing, so the
      // honest count is "the entries this command wrote" — zero on a replay.
      applied: result.duplicate ? 0 : resolved.entries.length,
      member: resolved.member,
      points: result.weekData.points[resolved.member] ?? 0,
      weekStart: result.weekData.weekStart,
      reconciled: result.reconciled && !repairRequired,
      repairRequired,
      duplicate: result.duplicate,
      ...(revision ? { revision } : {}),
    };
  })).catch(() => failure(
    command.operationId,
    command.action,
    "ledger_unavailable",
    emptyWeekData(weekStart),
    { member: resolved.member },
  ));
}
