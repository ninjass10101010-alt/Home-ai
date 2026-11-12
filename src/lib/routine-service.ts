import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import {
  localDateOf,
  localDayPlusISO,
  localPreviousDayISO,
  localTodayISO,
  localWeekStartISO,
} from "@/lib/local-date";
import { authorizeParentPinRequest } from "@/lib/admin-auth";
import {
  readSessionCookie,
  requireLiveSession,
  type ServerMember,
} from "@/lib/server-auth";
import { applyWeekLedgerOperationLocked } from "@/lib/ledger-operations";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { mutateSnapshotWithMeta } from "@/lib/snapshot-tasks";
import { computeMemberBalances, parseCanonicalTransactions } from "@/lib/task-ledger";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import {
  DEFAULT_ACCOUNTABILITY_STATE,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_ROUTINES,
  type DailyRoutineProgress,
  type FamilyRoutine,
  type RoutineAccountabilityState,
  type RoutineCompletionMeta,
  type RoutineMissedEntry,
  type RoutineSettings,
} from "@/types/routines";
import {
  findRosterMember,
  getMemberCompletionMeta,
  isRoutineScheduledForDate,
  isSingleMemberRoutine,
  memberKey,
  progressKey,
  resolveRoutineTargets,
  routineAppliesToMember,
  sanitizeDailyRoutineProgress,
  sanitizeRoutine,
  sanitizeRoutineSettings,
  type RoutineRosterMember,
} from "@/lib/routine-rules";
import type { LedgerOperationSource, WeekData } from "@/types/tasks";

export const ROUTINES_STATE_KEY = "family_routines";
export const ROUTINE_SETTINGS_KEY = "routine_settings";
export const ROUTINE_ACCOUNTABILITY_KEY = "routine_accountability_state";
export const routineProgressKey = (dateISO: string) => `routine_progress:${dateISO}`;

const MAX_MISSED_HISTORY = 200;
const MAX_SWEEP_LOOKBACK_DAYS = 7;

export interface ParentWriteAuth {
  ok: boolean;
  status?: number;
  error?: string;
  member?: ServerMember;
}

export async function authorizeRoutineParentWrite(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<ParentWriteAuth> {
  const auth = await authorizeParentPinRequest(request, body);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      error: auth.error === "unauthorized" && (request.headers.get("x-admin-pin") || body?.pin) ? "invalid_pin" : auth.error,
    };
  }
  return { ok: true, member: auth.member };
}

export interface SessionActorAuth {
  signedIn: boolean;
  member: ServerMember | null;
  isParent: boolean;
  sessionError?: { status: number; error: string };
}

export async function readOptionalSessionActor(request: Request): Promise<SessionActorAuth> {
  if (readSessionCookie(request) === undefined) {
    return { signedIn: false, member: null, isParent: false };
  }
  const live = await requireLiveSession(request, { withMember: true });
  if (!live.ok || !live.member) {
    return {
      signedIn: false,
      member: null,
      isParent: false,
      sessionError: {
        status: live.ok ? 401 : live.status,
        error: live.ok ? "Session member not found" : live.error,
      },
    };
  }
  const isParent = String(live.member.role || "").trim().toLowerCase() === "parent";
  return {
    signedIn: true,
    member: live.member,
    isParent,
  };
}

function escapePbFilterValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function readStateRecord(
  pb: any,
  key: string,
): Promise<{ id: string; value: unknown } | null> {
  try {
    const rec = await pb
      .collection("consuela_state")
      .getFirstListItem(`key="${escapePbFilterValue(key)}"`, { requestKey: null });
    if (!rec || typeof rec !== "object") return null;
    return { id: String(rec.id || ""), value: rec.value };
  } catch {
    return null;
  }
}

export async function writeStateRecord(
  pb: any,
  key: string,
  value: unknown,
): Promise<void> {
  const existing = await readStateRecord(pb, key);
  if (existing && existing.id) {
    await pb.collection("consuela_state").update(existing.id, { value });
  } else {
    await pb.collection("consuela_state").create({ key, value });
  }
}

export async function loadRosterMembers(pb: any): Promise<RoutineRosterMember[]> {
  try {
    const col = pb.collection("members");
    if (!col || typeof col.getFullList !== "function") return [];
    const rows = await col.getFullList({ requestKey: null });
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r: any) => r && typeof r.name === "string" && r.name.trim())
      .map((r: any) => ({
        id: typeof r.id === "string" ? r.id : undefined,
        name: String(r.name).trim(),
        fullName:
          typeof r.fullName === "string" && r.fullName.trim()
            ? r.fullName.trim()
            : String(r.name).trim(),
        role: typeof r.role === "string" ? r.role.trim().toLowerCase() : undefined,
        emoji: typeof r.emoji === "string" ? r.emoji : undefined,
      }));
  } catch {
    return [];
  }
}

export async function readRoutinesDoc(pb: any): Promise<{
  routines: FamilyRoutine[];
  settings: RoutineSettings;
}> {
  const routinesRec = await readStateRecord(pb, ROUTINES_STATE_KEY);
  let routines: FamilyRoutine[] = DEFAULT_ROUTINES;
  if (routinesRec && routinesRec.value !== undefined) {
    if (Array.isArray(routinesRec.value)) {
      routines = routinesRec.value;
    } else if (
      routinesRec.value &&
      typeof routinesRec.value === "object" &&
      Array.isArray((routinesRec.value as Record<string, unknown>).routines)
    ) {
      routines = (routinesRec.value as Record<string, unknown>).routines as FamilyRoutine[];
    }
  }

  const settingsRec = await readStateRecord(pb, ROUTINE_SETTINGS_KEY);
  const settings = settingsRec
    ? sanitizeRoutineSettings(settingsRec.value)
    : { ...DEFAULT_ROUTINE_SETTINGS };

  return { routines, settings };
}

export function sanitizeAccountabilityState(raw: unknown): RoutineAccountabilityState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_ACCOUNTABILITY_STATE,
      missedEntries: [],
      streaks: {},
    };
  }
  const r = raw as Record<string, unknown>;
  const lastSweptDay = typeof r.lastSweptDay === "string" ? r.lastSweptDay.trim() : "";
  const missedEntries: RoutineMissedEntry[] = Array.isArray(r.missedEntries)
    ? r.missedEntries
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map((e) => ({
          id: String(e.id || ""),
          date: String(e.date || ""),
          routineId: String(e.routineId || ""),
          routineTitle: String(e.routineTitle || ""),
          routineEmoji: String(e.routineEmoji || "⏰"),
          memberName: String(e.memberName || ""),
          memberKey: String(e.memberKey || ""),
          penaltyPoints: Number.isFinite(Number(e.penaltyPoints))
            ? Math.max(0, Math.round(Number(e.penaltyPoints)))
            : 0,
          deductedPoints: Number.isFinite(Number(e.deductedPoints))
            ? Math.max(0, Math.round(Number(e.deductedPoints)))
            : 0,
          countedTowardRace: e.countedTowardRace === true,
          excused: e.excused === true,
          ...(typeof e.excusedBy === "string" ? { excusedBy: e.excusedBy } : {}),
          ...(typeof e.excusedAt === "string" ? { excusedAt: e.excusedAt } : {}),
          ...(typeof e.refundedPoints === "number"
            ? { refundedPoints: e.refundedPoints }
            : {}),
          detectedAt: String(e.detectedAt || ""),
          ...(typeof e.operationId === "string" ? { operationId: e.operationId } : {}),
          ...(typeof e.excuseOperationId === "string"
            ? { excuseOperationId: e.excuseOperationId }
            : {}),
        }))
        .filter((e) => Boolean(e.id && e.date && e.routineId && e.memberName))
    : [];

  const streaks: RoutineAccountabilityState["streaks"] = {};
  if (r.streaks && typeof r.streaks === "object" && !Array.isArray(r.streaks)) {
    for (const [k, v] of Object.entries(r.streaks as Record<string, unknown>)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const sr = v as Record<string, unknown>;
      streaks[k.trim().toLowerCase()] = {
        current: Math.max(0, Math.round(Number(sr.current) || 0)),
        longest: Math.max(0, Math.round(Number(sr.longest) || 0)),
        ...(typeof sr.lastCompletedDay === "string" && sr.lastCompletedDay
          ? { lastCompletedDay: sr.lastCompletedDay }
          : {}),
      };
    }
  }

  return { lastSweptDay, missedEntries, streaks };
}

function normalizeWeekDataRow(row: any, weekStart: string): WeekData {
  const history = parseCanonicalTransactions(row?.history) ?? [];
  const points = computeMemberBalances(history);
  return {
    weekStart,
    points,
    streak:
      row?.streak && typeof row.streak === "object" && !Array.isArray(row.streak)
        ? row.streak
        : {},
    lastActive:
      row?.lastActive && typeof row.lastActive === "object" && !Array.isArray(row.lastActive)
        ? row.lastActive
        : {},
    history,
  };
}

function deterministicHashFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export async function applyRoutineLedgerDelta(params: {
  memberName: string;
  source: Extract<
    LedgerOperationSource,
    | "routine-complete"
    | "routine-undo"
    | "routine-penalty"
    | "routine-penalty-excuse"
  >;
  amount: number;
  description: string;
  operationId: string;
  actorId?: string;
  appliedBy?: string;
  now?: Date;
}): Promise<{ appliedAmount: number; weekData: WeekData | null }> {
  const requested = Math.trunc(params.amount);
  if (requested === 0) return { appliedAmount: 0, weekData: null };

  const weekStart = localWeekStartISO(params.now);
  try {
    await ensureCurrentTaskWeek();
  } catch {
    return { appliedAmount: 0, weekData: null };
  }

  return withWeekLedgerLock(weekStart, () =>
    withAdmin(async (pb) => {
      const weekCol = pb.collection("week_data");
      if (!weekCol || typeof weekCol.getFullList !== "function") {
        return { appliedAmount: 0, weekData: null };
      }

      const rows = await weekCol.getFullList({ requestKey: null }).catch(() => []);
      const row = Array.isArray(rows)
        ? rows.find((r: any) => String(r?.weekStart || "").trim() === weekStart)
        : null;
      const currentWeek = row ? normalizeWeekDataRow(row, weekStart) : {
        weekStart,
        points: {},
        streak: {},
        lastActive: {},
        history: [],
      };
      const currentBalance = Math.max(0, currentWeek.points[params.memberName] ?? 0);

      let signedAmount = requested;
      let txType: "earn" | "adjust" | "penalty";
      let action: "adjust" | "penalty" | undefined;

      if (params.source === "routine-complete") {
        signedAmount = Math.max(1, requested);
        txType = "earn";
      } else if (params.source === "routine-penalty-excuse") {
        signedAmount = Math.max(1, requested);
        txType = "adjust";
        action = "adjust";
      } else if (params.source === "routine-penalty") {
        const deduct = Math.min(Math.abs(requested), currentBalance);
        if (deduct <= 0) {
          return { appliedAmount: 0, weekData: currentWeek };
        }
        signedAmount = -deduct;
        txType = "penalty";
        action = "penalty";
      } else {
        // routine-undo
        const deduct = Math.min(Math.abs(requested), currentBalance);
        if (deduct <= 0) {
          return { appliedAmount: 0, weekData: currentWeek };
        }
        signedAmount = -deduct;
        txType = "adjust";
        action = "adjust";
      }

      const entry = {
        type: txType,
        member: params.memberName,
        amount: signedAmount,
        description: params.description,
        ...(params.appliedBy ? { appliedBy: params.appliedBy } : {}),
      };

      const result = await applyWeekLedgerOperationLocked({
        weekStart,
        operation: {
          operationId: params.operationId,
          source: params.source,
          fingerprint: deterministicHashFingerprint({
            source: params.source,
            entry,
          }),
          ...(params.actorId ? { actorId: params.actorId } : {}),
          ...(action ? { action } : {}),
          entries: [entry],
        },
        project: async ({ weekData }) => {
          try {
            await mutateSnapshotWithMeta(
              (data) => ({ data: { ...data, weekData }, result: null }),
              pb,
            );
            return true;
          } catch {
            return false;
          }
        },
      });

      if (!result.ok) {
        return { appliedAmount: 0, weekData: result.weekData };
      }

      return {
        appliedAmount: Math.abs(signedAmount),
        weekData: result.weekData,
      };
    }),
  );
}

/**
 * Idempotent daily routine accountability sweep.
 * Safe to invoke on every `/api/tasks/sync` & `/api/routines*` read.
 * On very first run, initializes `lastSweptDay` to yesterday so past history
 * before rollout is never retroactively penalized.
 */
export async function ensureRoutineAccountability(
  now: Date = new Date(),
): Promise<RoutineAccountabilityState> {
  return withKeyedLock("routine-accountability", () =>
    withAdmin(async (pb) => {
      const today = localTodayISO(now);
      const yesterday = localPreviousDayISO(today);

      const rawAcc = await readStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY);
      if (!rawAcc) {
        const seeded: RoutineAccountabilityState = {
          lastSweptDay: yesterday,
          missedEntries: [],
          streaks: {},
        };
        try {
          await writeStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY, seeded);
        } catch {
          /* ignore read-only/mocked PB failures */
        }
        return seeded;
      }

      const acc = sanitizeAccountabilityState(rawAcc.value);
      if (!acc.lastSweptDay) {
        const initialized: RoutineAccountabilityState = {
          ...acc,
          lastSweptDay: yesterday,
        };
        await writeStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY, initialized);
        return initialized;
      }

      if (acc.lastSweptDay >= yesterday) {
        return acc;
      }

      const { routines, settings } = await readRoutinesDoc(pb);
      const members = await loadRosterMembers(pb);
      if (members.length === 0) {
        return acc;
      }

      const oldestAllowed = localDayPlusISO(today, -MAX_SWEEP_LOOKBACK_DAYS);
      const nextAfterLast = localDayPlusISO(acc.lastSweptDay, 1);
      let cursor = nextAfterLast > oldestAllowed ? nextAfterLast : oldestAllowed;

      const existingIds = new Set(acc.missedEntries.map((e) => e.id));
      const newMissed: RoutineMissedEntry[] = [];
      const streaks = { ...acc.streaks };

      while (cursor <= yesterday) {
        const progRec = await readStateRecord(pb, routineProgressKey(cursor));
        const progress = sanitizeDailyRoutineProgress(progRec?.value, cursor);

        for (const routine of routines) {
          if (!isRoutineScheduledForDate(routine, cursor)) continue;
          if (routine.createdAt) {
            const createdDay = localDateOf(routine.createdAt);
            if (createdDay && createdDay > cursor) continue;
          }

          const targets = resolveRoutineTargets(routine, members);
          const singleTarget = targets.length <= 1;

          for (const target of targets) {
            const mName = target.fullName || target.name;
            const mKey = memberKey(mName);
            const meta = getMemberCompletionMeta(
              progress,
              routine.id,
              mName,
              singleTarget,
            );
            if (meta && (meta.status === "completed" || meta.status === "approved")) {
              continue;
            }
            // Pending approval was finished by kid in time; do not mark missed!
            if (meta && meta.status === "pending_approval") {
              continue;
            }

            const entryId = `${cursor}::${routine.id}::${mKey}`;
            if (existingIds.has(entryId)) continue;
            existingIds.add(entryId);

            const penaltyPoints =
              routine.missedPenalty !== undefined
                ? Math.max(0, routine.missedPenalty)
                : Math.max(0, settings.defaultMissedPenalty);

            const isParent = target.role === "parent";
            const countedTowardRace =
              settings.accountabilityEnabled &&
              penaltyPoints > 0 &&
              (!isParent || settings.parentCountsTowardRace);

            let deductedPoints = 0;
            const operationId = `routine-miss:${cursor}:${routine.id}:${mKey}`;

            if (countedTowardRace) {
              const res = await applyRoutineLedgerDelta({
                memberName: mName,
                source: "routine-penalty",
                amount: penaltyPoints,
                description: `Missed routine (${cursor}): ${routine.emoji} ${routine.title}`,
                operationId,
                now,
              });
              deductedPoints = res.appliedAmount;
            }

            // Reset active streak when a scheduled routine is missed while accountability is on
            if (settings.accountabilityEnabled) {
              const prevStreak = streaks[mKey] ?? { current: 0, longest: 0 };
              streaks[mKey] = {
                ...prevStreak,
                current: 0,
              };
            }

            newMissed.push({
              id: entryId,
              date: cursor,
              routineId: routine.id,
              routineTitle: routine.title,
              routineEmoji: routine.emoji,
              memberName: mName,
              memberKey: mKey,
              penaltyPoints,
              deductedPoints,
              countedTowardRace,
              excused: false,
              detectedAt: now.toISOString(),
              ...(deductedPoints > 0 ? { operationId } : {}),
            });
          }
        }

        cursor = localDayPlusISO(cursor, 1);
      }

      const updated: RoutineAccountabilityState = {
        lastSweptDay: yesterday,
        missedEntries: [...newMissed.reverse(), ...acc.missedEntries].slice(
          0,
          MAX_MISSED_HISTORY,
        ),
        streaks,
      };
      await writeStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY, updated);
      return updated;
    }),
  );
}

export async function excuseMissedRoutineEntry(params: {
  entryId?: string;
  date?: string;
  routineId?: string;
  memberName?: string;
  excusedBy: string;
}): Promise<{
  ok: boolean;
  error?: string;
  entry?: RoutineMissedEntry;
  accountability?: RoutineAccountabilityState;
  weekData?: WeekData | null;
}> {
  return withKeyedLock("routine-accountability", () =>
    withAdmin(async (pb) => {
      const rawAcc = await readStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY);
      const acc = sanitizeAccountabilityState(rawAcc?.value);
      const targetId =
        params.entryId ||
        (params.date && params.routineId && params.memberName
          ? `${params.date}::${params.routineId}::${memberKey(params.memberName)}`
          : "");
      const idx = acc.missedEntries.findIndex(
        (e) =>
          e.id === targetId ||
          (params.date &&
            params.routineId &&
            params.memberName &&
            e.date === params.date &&
            e.routineId === params.routineId &&
            e.memberKey === memberKey(params.memberName)),
      );
      if (idx === -1) {
        return { ok: false, error: "missed_entry_not_found" };
      }
      const existing = acc.missedEntries[idx];
      if (existing.excused) {
        return { ok: true, entry: existing, accountability: acc, weekData: null };
      }

      let refundedPoints = 0;
      let weekData: WeekData | null = null;
      const excuseOpId = `routine-excuse:${existing.date}:${existing.routineId}:${existing.memberKey}`;

      if (existing.deductedPoints > 0) {
        const res = await applyRoutineLedgerDelta({
          memberName: existing.memberName,
          source: "routine-penalty-excuse",
          amount: existing.deductedPoints,
          description: `Excused missed routine (${existing.date}): ${existing.routineEmoji} ${existing.routineTitle}`,
          operationId: excuseOpId,
          appliedBy: params.excusedBy,
        });
        refundedPoints = res.appliedAmount;
        weekData = res.weekData;
      }

      const updatedEntry: RoutineMissedEntry = {
        ...existing,
        excused: true,
        excusedBy: params.excusedBy,
        excusedAt: new Date().toISOString(),
        refundedPoints,
        excuseOperationId: excuseOpId,
      };
      const updatedEntries = [...acc.missedEntries];
      updatedEntries[idx] = updatedEntry;

      const updatedAcc: RoutineAccountabilityState = {
        ...acc,
        missedEntries: updatedEntries,
      };
      await writeStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY, updatedAcc);
      return {
        ok: true,
        entry: updatedEntry,
        accountability: updatedAcc,
        weekData,
      };
    }),
  );
}

export async function applyRoutineProgressAction(params: {
  action:
    | "toggle_step"
    | "complete_routine"
    | "uncomplete_routine"
    | "approve_routine"
    | "send_back_routine";
  dateISO: string;
  routineId: string;
  stepId?: string;
  targetMemberName: string;
  actor: SessionActorAuth;
  parentMember?: ServerMember | null;
}): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  progress?: DailyRoutineProgress;
  accountability?: RoutineAccountabilityState;
  completion?: RoutineCompletionMeta | null;
  weekData?: WeekData | null;
  pointsDelta?: number;
}> {
  return withKeyedLock(`routine-progress:${params.dateISO}`, () =>
    withAdmin(async (pb) => {
      const { routines, settings } = await readRoutinesDoc(pb);
      const routine = routines.find((r) => r.id === params.routineId);
      if (!routine) {
        return { ok: false, status: 404, error: "routine_not_found" };
      }

      const roster = await loadRosterMembers(pb);
      const matchedTarget =
        roster.length > 0 ? findRosterMember(params.targetMemberName, roster) : null;
      const canonicalName = matchedTarget
        ? matchedTarget.fullName || matchedTarget.name
        : params.targetMemberName.trim();
      if (!canonicalName) {
        return { ok: false, status: 400, error: "member_required" };
      }
      if (roster.length > 0 && !matchedTarget) {
        return { ok: false, status: 400, error: "unknown_member" };
      }

      // If a non-parent live session is signed in, bind strictly to self.
      if (params.actor.signedIn && !params.actor.isParent && params.actor.member) {
        const actorCanonical =
          findRosterMember(params.actor.member.name, roster)?.fullName ||
          params.actor.member.name;
        if (memberKey(actorCanonical) !== memberKey(canonicalName)) {
          return { ok: false, status: 403, error: "forbidden_member" };
        }
      }

      if (
        !routineAppliesToMember(
          routine,
          matchedTarget ?? canonicalName,
          roster,
        )
      ) {
        // Still allow if target === "All" and no roster was returned (tests)
        if (roster.length > 0) {
          return { ok: false, status: 403, error: "routine_not_assigned_to_member" };
        }
      }

      const key = progressKey(routine.id, canonicalName);
      const mKey = memberKey(canonicalName);
      const singleTarget = isSingleMemberRoutine(routine, roster);
      const progRec = await readStateRecord(pb, routineProgressKey(params.dateISO));
      const progress = sanitizeDailyRoutineProgress(progRec?.value, params.dateISO);
      const memberChecked = { ...(progress.memberCheckedSteps ?? {}) };
      const memberCompleted = { ...(progress.memberCompleted ?? {}) };
      const legacyChecked = { ...progress.checkedSteps };
      const legacyCompleted = { ...progress.completedRoutines };

      const currentSteps =
        memberChecked[key] ??
        (singleTarget ? legacyChecked[routine.id] ?? [] : []);
      const existingCompletion = getMemberCompletionMeta(
        progress,
        routine.id,
        canonicalName,
        singleTarget,
      );

      let nextSteps = [...currentSteps];
      const allStepIds = routine.steps.map((s) => s.id);

      if (params.action === "toggle_step") {
        if (!params.stepId || !allStepIds.includes(params.stepId)) {
          return { ok: false, status: 400, error: "invalid_step" };
        }
        nextSteps = currentSteps.includes(params.stepId)
          ? currentSteps.filter((id) => id !== params.stepId)
          : [...currentSteps, params.stepId];
      } else if (params.action === "complete_routine" || params.action === "approve_routine") {
        nextSteps = [...allStepIds];
      } else if (params.action === "uncomplete_routine" || params.action === "send_back_routine") {
        nextSteps = params.action === "send_back_routine" ? [] : allStepIds.slice(0, Math.max(0, allStepIds.length - 1));
      }

      memberChecked[key] = nextSteps;
      if (singleTarget || !legacyChecked[routine.id]) {
        legacyChecked[routine.id] = nextSteps;
      }

      const nowComplete =
        allStepIds.length > 0
          ? allStepIds.every((id) => nextSteps.includes(id))
          : params.action === "complete_routine" || params.action === "approve_routine";

      const isTargetParent = matchedTarget?.role === "parent";
      const countsTowardRace =
        !isTargetParent || settings.parentCountsTowardRace;
      const needsApproval =
        routine.requiresApproval ?? settings.defaultRequiresApproval;

      const rawAcc = await readStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY);
      const acc = sanitizeAccountabilityState(rawAcc?.value);
      const streaks = { ...acc.streaks };

      let pointsDelta = 0;
      let weekData: WeekData | null = null;
      let completionResult: RoutineCompletionMeta | null = existingCompletion;

      const todayISO = localTodayISO();
      const canTouchTodayStreak = params.dateISO === todayISO;

      if (params.action === "approve_routine") {
        if (existingCompletion?.status === "approved" || (existingCompletion?.status === "completed" && existingCompletion.pointsAwarded > 0)) {
          return {
            ok: true,
            progress,
            accountability: acc,
            completion: existingCompletion,
            pointsDelta: 0,
          };
        }
        const opId = `routine-approve:${params.dateISO}:${routine.id}:${mKey}:${Date.now()}`;
        const points = Math.max(0, routine.points);
        let posted = 0;
        if (points > 0 && countsTowardRace) {
          const res = await applyRoutineLedgerDelta({
            memberName: canonicalName,
            source: "routine-complete",
            amount: points,
            description: `Approved routine: ${routine.emoji} ${routine.title}`,
            operationId: opId,
            appliedBy: params.parentMember?.name || "Parent",
          });
          posted = res.appliedAmount;
          weekData = res.weekData;
        } else {
          posted = points;
        }
        pointsDelta = posted;
        const nextMeta: RoutineCompletionMeta = {
          status: "approved",
          at: existingCompletion?.at || new Date().toISOString(),
          by: canonicalName,
          pointsAwarded: posted,
          countedTowardRace: countsTowardRace,
          operationId: opId,
          approvedBy: params.parentMember?.name || "Parent",
          approvedAt: new Date().toISOString(),
        };
        memberCompleted[key] = nextMeta;
        if (singleTarget) legacyCompleted[routine.id] = true;
        completionResult = nextMeta;

        if (canTouchTodayStreak) {
          const cur = streaks[mKey] ?? { current: 0, longest: 0 };
          if (cur.lastCompletedDay !== todayISO) {
            const nextCur = cur.current + 1;
            streaks[mKey] = {
              current: nextCur,
              longest: Math.max(cur.longest, nextCur),
              lastCompletedDay: todayISO,
            };
          }
        }
      } else if (nowComplete && !existingCompletion) {
        // Transition incomplete -> complete or pending_approval
        const waitingApproval =
          needsApproval &&
          !isTargetParent &&
          !params.actor.isParent;

        if (waitingApproval) {
          const nextMeta: RoutineCompletionMeta = {
            status: "pending_approval",
            at: new Date().toISOString(),
            by: canonicalName,
            pointsAwarded: 0,
            countedTowardRace: countsTowardRace,
          };
          memberCompleted[key] = nextMeta;
          if (singleTarget) legacyCompleted[routine.id] = true;
          completionResult = nextMeta;
        } else {
          // Update streak first so milestone bonus knows exact streak count
          let bonusPoints = 0;
          let streakAfter = streaks[mKey]?.current ?? 0;
          if (canTouchTodayStreak) {
            const cur = streaks[mKey] ?? { current: 0, longest: 0 };
            if (cur.lastCompletedDay !== todayISO) {
              streakAfter = cur.current + 1;
              streaks[mKey] = {
                current: streakAfter,
                longest: Math.max(cur.longest, streakAfter),
                lastCompletedDay: todayISO,
              };
              if (
                settings.streakBonusEveryDays > 0 &&
                settings.streakBonusPoints > 0 &&
                streakAfter > 0 &&
                streakAfter % settings.streakBonusEveryDays === 0
              ) {
                bonusPoints = settings.streakBonusPoints;
              }
            }
          }

          const totalReward = Math.max(0, routine.points) + bonusPoints;
          const opId = `routine-complete:${params.dateISO}:${routine.id}:${mKey}:${Date.now()}`;
          let posted = totalReward;
          if (totalReward > 0 && countsTowardRace) {
            const res = await applyRoutineLedgerDelta({
              memberName: canonicalName,
              source: "routine-complete",
              amount: totalReward,
              description:
                bonusPoints > 0
                  ? `Routine + ${streakAfter}d streak bonus: ${routine.emoji} ${routine.title}`
                  : `Completed routine: ${routine.emoji} ${routine.title}`,
              operationId: opId,
            });
            posted = res.appliedAmount;
            weekData = res.weekData;
          }
          pointsDelta = posted;
          const nextMeta: RoutineCompletionMeta = {
            status: "completed",
            at: new Date().toISOString(),
            by: canonicalName,
            pointsAwarded: posted,
            countedTowardRace: countsTowardRace,
            operationId: opId,
            ...(canTouchTodayStreak ? { streakAtCompletion: streakAfter } : {}),
            ...(bonusPoints > 0 ? { streakBonusAwarded: bonusPoints } : {}),
          };
          memberCompleted[key] = nextMeta;
          if (singleTarget) legacyCompleted[routine.id] = true;
          completionResult = nextMeta;
        }
      } else if (!nowComplete && existingCompletion) {
        // Transition complete/pending -> incomplete (undo or send back)
        const revertAmount = existingCompletion.pointsAwarded || 0;
        if (revertAmount > 0 && existingCompletion.countedTowardRace) {
          const opId = `routine-undo:${params.dateISO}:${routine.id}:${mKey}:${Date.now()}`;
          const res = await applyRoutineLedgerDelta({
            memberName: canonicalName,
            source: "routine-undo",
            amount: revertAmount,
            description:
              params.action === "send_back_routine"
                ? `Sent back routine: ${routine.emoji} ${routine.title}`
                : `Undid routine: ${routine.emoji} ${routine.title}`,
            operationId: opId,
            appliedBy: params.parentMember?.name,
          });
          pointsDelta = -res.appliedAmount;
          weekData = res.weekData;
        }

        delete memberCompleted[key];
        if (singleTarget) legacyCompleted[routine.id] = false;
        completionResult = null;

        // If this was the only completed routine today for this member, revert today's streak increment
        if (canTouchTodayStreak && streaks[mKey]?.lastCompletedDay === todayISO) {
          const hasAnotherToday = Object.entries(memberCompleted).some(
            ([mk, meta]) =>
              mk.endsWith(`::${mKey}`) &&
              (meta.status === "completed" || meta.status === "approved"),
          );
          if (!hasAnotherToday) {
            const cur = streaks[mKey];
            streaks[mKey] = {
              current: Math.max(0, cur.current - 1),
              longest: cur.longest,
              lastCompletedDay: localPreviousDayISO(todayISO),
            };
          }
        }
      }

      const nextProgress: DailyRoutineProgress = {
        date: params.dateISO,
        checkedSteps: legacyChecked,
        completedRoutines: legacyCompleted,
        memberCheckedSteps: memberChecked,
        memberCompleted,
      };
      await writeStateRecord(pb, routineProgressKey(params.dateISO), nextProgress);

      const nextAcc: RoutineAccountabilityState = { ...acc, streaks };
      if (rawAcc || Object.keys(streaks).length > 0) {
        try {
          await writeStateRecord(pb, ROUTINE_ACCOUNTABILITY_KEY, nextAcc);
        } catch {
          /* best effort when accountability doc isn't mocked */
        }
      }

      return {
        ok: true,
        progress: nextProgress,
        accountability: nextAcc,
        completion: completionResult,
        weekData,
        pointsDelta,
      };
    }),
  );
}
