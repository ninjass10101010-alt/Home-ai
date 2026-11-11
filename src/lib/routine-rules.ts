import {
  ALL_ROUTINE_DAYS,
  DEFAULT_ROUTINE_SETTINGS,
  ROUTINE_DAY_META,
  WEEKDAY_ROUTINE_DAYS,
  WEEKEND_ROUTINE_DAYS,
  type DailyRoutineProgress,
  type FamilyRoutine,
  type RoutineCompletionMeta,
  type RoutineDayCode,
  type RoutineSettings,
  type RoutineSlot,
  type RoutineStep,
} from "@/types/routines";

export interface RoutineRosterMember {
  id?: string;
  name: string;
  fullName?: string;
  role?: string;
  emoji?: string;
}

const VALID_SLOTS = new Set<RoutineSlot>(["morning", "afternoon", "evening", "weekend"]);
const VALID_DAYS = new Set<RoutineDayCode>(ALL_ROUTINE_DAYS);

export function weekdayCodeForDateISO(dateISO: string): RoutineDayCode | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateISO || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return ALL_ROUTINE_DAYS[dt.getUTCDay()] ?? null;
}

export function normalizeDayCodes(raw: unknown): RoutineDayCode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<RoutineDayCode>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const norm = item.trim().toLowerCase().slice(0, 3) as RoutineDayCode;
    if (VALID_DAYS.has(norm)) seen.add(norm);
  }
  if (seen.size === 0) return undefined;
  return ALL_ROUTINE_DAYS.filter((d) => seen.has(d));
}

export function effectiveDaysOfWeek(
  routine: Pick<FamilyRoutine, "daysOfWeek" | "slot">,
): RoutineDayCode[] {
  const normalized = normalizeDayCodes(routine.daysOfWeek);
  if (normalized && normalized.length > 0) return normalized;
  if (routine.slot === "weekend") return [...WEEKEND_ROUTINE_DAYS];
  return [...ALL_ROUTINE_DAYS];
}

export function isRoutineScheduledForDate(
  routine: Pick<FamilyRoutine, "daysOfWeek" | "slot" | "active">,
  dateISO: string,
): boolean {
  if (routine.active === false) return false;
  const code = weekdayCodeForDateISO(dateISO);
  if (!code) return true;
  return effectiveDaysOfWeek(routine).includes(code);
}

export function formatRoutineDaysLabel(
  daysOfWeek?: RoutineDayCode[],
  slot?: RoutineSlot,
): string {
  const days = effectiveDaysOfWeek({ daysOfWeek, slot: slot ?? "morning" });
  if (days.length === 7) return "Every day";
  if (
    days.length === 5 &&
    WEEKDAY_ROUTINE_DAYS.every((d) => days.includes(d))
  ) {
    return "Weekdays";
  }
  if (
    days.length === 2 &&
    WEEKEND_ROUTINE_DAYS.every((d) => days.includes(d))
  ) {
    return "Weekends";
  }
  if (days.length === 1) {
    return `Every ${ROUTINE_DAY_META[days[0]].short}`;
  }
  return days.map((d) => ROUTINE_DAY_META[d].short).join(" · ");
}

export function memberKey(name: string): string {
  return name.trim().toLowerCase();
}

export function progressKey(routineId: string, memberName: string): string {
  return `${routineId}::${memberKey(memberName)}`;
}

function canonicalRosterName(m: RoutineRosterMember): string {
  return (m.fullName || m.name || "").trim();
}

function firstTokenLower(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export function findRosterMember(
  rawName: string | null | undefined,
  members: readonly RoutineRosterMember[],
): RoutineRosterMember | null {
  const raw = (rawName ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const exact = members.find((m) => {
    const full = (m.fullName || "").trim().toLowerCase();
    const short = (m.name || "").trim().toLowerCase();
    return full === lower || short === lower;
  });
  if (exact) return exact;
  const targetFirst = firstTokenLower(raw);
  if (!targetFirst) return null;
  return (
    members.find(
      (m) =>
        firstTokenLower(m.fullName || m.name) === targetFirst ||
        firstTokenLower(m.name) === targetFirst,
    ) ?? null
  );
}

export function rawRoutineTargets(
  routine: Pick<FamilyRoutine, "assignee" | "assignees">,
): string[] {
  const multi = Array.isArray(routine.assignees)
    ? routine.assignees.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  if (multi.length > 0) return multi;
  const single = String(routine.assignee ?? "").trim();
  return single ? [single] : ["All"];
}

export function formatRoutineTargetsLabel(
  routine: Pick<FamilyRoutine, "assignee" | "assignees">,
): string {
  const targets = rawRoutineTargets(routine);
  if (targets.length === 1) {
    const t = targets[0].toLowerCase();
    if (t === "all") return "Everyone";
    if (t === "kids") return "Kids";
    if (t === "adults") return "Adults";
    return targets[0];
  }
  return targets.join(", ");
}

export function resolveRoutineTargets(
  routine: Pick<FamilyRoutine, "assignee" | "assignees">,
  members: readonly RoutineRosterMember[],
): RoutineRosterMember[] {
  const targets = rawRoutineTargets(routine);
  const resolved: RoutineRosterMember[] = [];
  const seen = new Set<string>();

  const push = (m: RoutineRosterMember) => {
    const cname = canonicalRosterName(m);
    if (!cname) return;
    const key = cname.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    resolved.push({ ...m, name: cname });
  };

  for (const target of targets) {
    const norm = target.trim().toLowerCase();
    if (norm === "all" || norm === "everyone") {
      for (const m of members) {
        if (m.role !== "pet") push(m);
      }
    } else if (norm === "kids" || norm === "children") {
      for (const m of members) {
        if (m.role === "child") push(m);
      }
    } else if (norm === "adults" || norm === "parents") {
      for (const m of members) {
        if (m.role === "parent") push(m);
      }
    } else {
      const matched = findRosterMember(target, members);
      if (matched) push(matched);
    }
  }
  return resolved;
}

export function routineAppliesToMember(
  routine: Pick<FamilyRoutine, "assignee" | "assignees">,
  member: RoutineRosterMember | string,
  members: readonly RoutineRosterMember[] = [],
): boolean {
  const rawName = typeof member === "string" ? member : canonicalRosterName(member);
  const role = typeof member === "string" ? undefined : member.role;
  const targets = rawRoutineTargets(routine);

  if (members.length > 0) {
    const resolved = resolveRoutineTargets(routine, members);
    const key = memberKey(rawName);
    const first = firstTokenLower(rawName);
    return resolved.some(
      (m) =>
        memberKey(canonicalRosterName(m)) === key ||
        (first !== "" && firstTokenLower(canonicalRosterName(m)) === first),
    );
  }

  for (const target of targets) {
    const norm = target.trim().toLowerCase();
    if (norm === "all" || norm === "everyone") {
      if (role !== "pet") return true;
    } else if (norm === "kids" || norm === "children") {
      if (role === "child") return true;
    } else if (norm === "adults" || norm === "parents") {
      if (role === "parent") return true;
    } else {
      if (norm === memberKey(rawName)) return true;
      const tFirst = firstTokenLower(norm);
      if (tFirst && tFirst === firstTokenLower(rawName)) return true;
    }
  }
  return false;
}

export function getMemberCheckedSteps(
  progress: DailyRoutineProgress,
  routineId: string,
  memberName?: string,
  allowLegacyFallback = false,
): string[] {
  if (memberName) {
    const key = progressKey(routineId, memberName);
    const scoped = progress.memberCheckedSteps?.[key];
    if (Array.isArray(scoped)) return scoped;
    if (!allowLegacyFallback) return [];
  }
  return Array.isArray(progress.checkedSteps?.[routineId])
    ? progress.checkedSteps[routineId]
    : [];
}

export function getMemberCompletionMeta(
  progress: DailyRoutineProgress,
  routineId: string,
  memberName?: string,
  allowLegacyFallback = false,
): RoutineCompletionMeta | null {
  if (memberName) {
    const key = progressKey(routineId, memberName);
    const scoped = progress.memberCompleted?.[key];
    if (scoped) return scoped;
    if (!allowLegacyFallback) return null;
  }
  if (progress.completedRoutines?.[routineId]) {
    return {
      status: "completed",
      at: "",
      by: memberName || "Family",
      pointsAwarded: 0,
      countedTowardRace: false,
    };
  }
  return null;
}

export function isSingleMemberRoutine(
  routine: Pick<FamilyRoutine, "assignee" | "assignees">,
  members: readonly RoutineRosterMember[],
): boolean {
  if (members.length > 0) {
    return resolveRoutineTargets(routine, members).length <= 1;
  }
  const targets = rawRoutineTargets(routine);
  if (targets.length !== 1) return false;
  const low = targets[0].toLowerCase();
  return low !== "all" && low !== "everyone" && low !== "kids" && low !== "adults";
}

function clampNonNegInt(value: unknown, fallback: number, max = 1000): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function sanitizeRoutineSettings(raw: unknown): RoutineSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  return {
    defaultPoints: clampNonNegInt(
      r.defaultPoints,
      DEFAULT_ROUTINE_SETTINGS.defaultPoints,
      500,
    ),
    defaultMissedPenalty: clampNonNegInt(
      r.defaultMissedPenalty,
      DEFAULT_ROUTINE_SETTINGS.defaultMissedPenalty,
      500,
    ),
    accountabilityEnabled:
      typeof r.accountabilityEnabled === "boolean"
        ? r.accountabilityEnabled
        : DEFAULT_ROUTINE_SETTINGS.accountabilityEnabled,
    parentCountsTowardRace:
      typeof r.parentCountsTowardRace === "boolean"
        ? r.parentCountsTowardRace
        : DEFAULT_ROUTINE_SETTINGS.parentCountsTowardRace,
    defaultRequiresApproval:
      typeof r.defaultRequiresApproval === "boolean"
        ? r.defaultRequiresApproval
        : DEFAULT_ROUTINE_SETTINGS.defaultRequiresApproval,
    streakBonusEveryDays: clampNonNegInt(
      r.streakBonusEveryDays,
      DEFAULT_ROUTINE_SETTINGS.streakBonusEveryDays,
      365,
    ),
    streakBonusPoints: clampNonNegInt(
      r.streakBonusPoints,
      DEFAULT_ROUTINE_SETTINGS.streakBonusPoints,
      500,
    ),
  };
}

export function sanitizeRoutine(
  raw: unknown,
  fallbackSettings: RoutineSettings = DEFAULT_ROUTINE_SETTINGS,
): FamilyRoutine | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "";
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : "";
  if (!id || !title) return null;

  const slot: RoutineSlot =
    typeof r.slot === "string" && VALID_SLOTS.has(r.slot as RoutineSlot)
      ? (r.slot as RoutineSlot)
      : "morning";
  const emoji = typeof r.emoji === "string" && r.emoji.trim() ? r.emoji.trim() : "⏰";
  const time = typeof r.time === "string" && r.time.trim() ? r.time.trim() : "08:00";

  const assignees = Array.isArray(r.assignees)
    ? r.assignees.map((v) => String(v ?? "").trim()).filter(Boolean)
    : undefined;
  const assignee =
    typeof r.assignee === "string" && r.assignee.trim()
      ? r.assignee.trim()
      : assignees && assignees.length > 0
        ? assignees[0]
        : "All";

  const daysOfWeek = normalizeDayCodes(r.daysOfWeek);
  const points = clampNonNegInt(r.points, fallbackSettings.defaultPoints, 500);
  const missedPenalty =
    r.missedPenalty === undefined || r.missedPenalty === null
      ? undefined
      : clampNonNegInt(r.missedPenalty, fallbackSettings.defaultMissedPenalty, 500);

  const steps: RoutineStep[] = Array.isArray(r.steps)
    ? r.steps
        .map((st, idx): RoutineStep | null => {
          if (!st || typeof st !== "object" || Array.isArray(st)) return null;
          const sr = st as Record<string, unknown>;
          const sTitle = typeof sr.title === "string" ? sr.title.trim() : "";
          if (!sTitle) return null;
          const sId =
            typeof sr.id === "string" && sr.id.trim()
              ? sr.id.trim()
              : `${id}-s-${idx + 1}`;
          const sEmoji =
            typeof sr.emoji === "string" && sr.emoji.trim() ? sr.emoji.trim() : "✓";
          return { id: sId, title: sTitle, emoji: sEmoji };
        })
        .filter((s): s is RoutineStep => s !== null)
    : [];

  return {
    id,
    title,
    emoji,
    slot,
    time,
    assignee,
    ...(assignees && assignees.length > 0 ? { assignees } : {}),
    ...(daysOfWeek && daysOfWeek.length > 0 ? { daysOfWeek } : {}),
    points,
    ...(missedPenalty !== undefined ? { missedPenalty } : {}),
    ...(typeof r.requiresApproval === "boolean"
      ? { requiresApproval: r.requiresApproval }
      : {}),
    ...(typeof r.active === "boolean" ? { active: r.active } : {}),
    ...(typeof r.createdAt === "string" && r.createdAt.trim()
      ? { createdAt: r.createdAt.trim() }
      : {}),
    steps,
  };
}

export function sanitizeDailyRoutineProgress(
  raw: unknown,
  date?: string,
): DailyRoutineProgress {
  const r = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const normalizeStepMap = (input: unknown): Record<string, string[]> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      out[k] = Array.from(
        new Set(v.map((s) => String(s ?? "").trim()).filter(Boolean)),
      );
    }
    return out;
  };

  const completedRoutines: Record<string, boolean> = {};
  if (
    r.completedRoutines &&
    typeof r.completedRoutines === "object" &&
    !Array.isArray(r.completedRoutines)
  ) {
    for (const [k, v] of Object.entries(r.completedRoutines as Record<string, unknown>)) {
      if (typeof v === "boolean") completedRoutines[k] = v;
    }
  }

  const memberCompleted: Record<string, RoutineCompletionMeta> = {};
  if (
    r.memberCompleted &&
    typeof r.memberCompleted === "object" &&
    !Array.isArray(r.memberCompleted)
  ) {
    for (const [k, v] of Object.entries(r.memberCompleted as Record<string, unknown>)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const mr = v as Record<string, unknown>;
      const status =
        mr.status === "pending_approval" || mr.status === "approved"
          ? mr.status
          : "completed";
      memberCompleted[k] = {
        status,
        at: typeof mr.at === "string" ? mr.at : "",
        by: typeof mr.by === "string" ? mr.by : "",
        pointsAwarded:
          typeof mr.pointsAwarded === "number" && Number.isFinite(mr.pointsAwarded)
            ? Math.max(0, Math.round(mr.pointsAwarded))
            : 0,
        countedTowardRace: mr.countedTowardRace === true,
        ...(typeof mr.operationId === "string" ? { operationId: mr.operationId } : {}),
        ...(typeof mr.approvedBy === "string" ? { approvedBy: mr.approvedBy } : {}),
        ...(typeof mr.approvedAt === "string" ? { approvedAt: mr.approvedAt } : {}),
        ...(typeof mr.streakAtCompletion === "number"
          ? { streakAtCompletion: mr.streakAtCompletion }
          : {}),
        ...(typeof mr.streakBonusAwarded === "number"
          ? { streakBonusAwarded: mr.streakBonusAwarded }
          : {}),
      };
    }
  }

  return {
    ...(date ? { date } : typeof r.date === "string" ? { date: r.date } : {}),
    checkedSteps: normalizeStepMap(r.checkedSteps),
    completedRoutines,
    memberCheckedSteps: normalizeStepMap(r.memberCheckedSteps),
    memberCompleted,
  };
}

