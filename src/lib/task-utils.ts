import { db } from "@/db";
import { localDateOf, localTodayISO, localWeekStartISO } from "@/lib/local-date";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { isRecord } from "@/lib/task-operation-contract";
import type { Task, WeekData, Transaction, WeekArchive, FamilyGoal, HallOfFameEntry, WeeklyPrize, CrewMember, CrewCloseMode } from "@/types/tasks";

export const TASKS_STORAGE_KEY = "consuela-tasks";
export const WEEK_DATA_KEY = "consuela-week-data";
export const ARCHIVE_KEY = "consuela-week-archive";
export const REWARDS_KEY = "consuela-rewards";
export const PENALTIES_KEY = "consuela-penalties";
// Durable removal signal for the tasks snapshot: the client merge is add-only,
// so a chat-initiated delete needs a tombstone every device honours (otherwise
// the next push resurrects the row).
export const DELETED_TASKS_KEY = "consuela-deleted-task-ids";
export const FAMILY_GOAL_KEY = "consuela-family-goal";
export const HALL_OF_FAME_KEY = "consuela-hall-of-fame";

// NOTE: the week key is NOT computed here. `localWeekStartISO()`
// (src/lib/local-date) is the single source of truth for "this week", and
// `weekStartForDate()` (src/lib/meals-week-utils) for "the week containing
// this date-only string" — it serializes from the family's LOCAL calendar
// date, so both are correct in any timezone. The `todayMondayISO()` /
// `weekKey()` pair that used to live here, backed by `mondayOf()`, did
// `setHours(0,0,0,0)` and then `.toISOString()`: local midnight serialized as
// UTC, which east of UTC resolved to the PREVIOUS day and on a Sunday to the
// previous week. The client's `completedInWeek` guard and both money-path week
// keys now read the canonical helper.
//
// `mondayOf()` below survives only for the two tests that still call it, and
// it is `setHours(0,0,0,0)`-based: it is correct only for an instant already
// anchored to local midnight, and silently wrong for a UTC-parsed one. Do not
// hand it `new Date(<date-only string>)` — use `weekStartForDate(string)`.
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// A stealable task becomes anyone's game the day AFTER its due date (day
// precision — tasks carry date-only dues). Universal claiming is orthogonal:
// a task may be universal AND stealable. `today` defaults to the family's
// local calendar date (not UTC — at 8pm Detroit UTC has already rolled to
// tomorrow, which would make same-day dues falsely snatchable).
export function isSnatchable(task: Task, today: string = localTodayISO()): boolean {
  return !!task.stealable && !task.completed && !!task.due && task.due < today;
}

// Tap-to-complete with pending parent approval: a kid's tap marks the task
// done immediately but writes NO earn transaction — points land only when a
// parent approves (approvePendingCompletion) and vanish on send-back.
export function isPendingApproval(task: Task): boolean {
  return !!task.completed && !!task.pendingApproval;
}

export function pendingApprovals(tasks: Task[]): Task[] {
  return (tasks || []).filter(isPendingApproval);
}

export function pendingPointsFor(memberName: string, tasks: Task[]): number {
  return pendingApprovals(tasks).reduce((sum, t) => {
    const pa = t.pendingApproval!;
    // Crew completions name the whole roster; each joined member is owed the
    // full points ("+Npts on the way" must include an in-flight crew).
    if (Array.isArray(pa.crew) && pa.crew.includes(memberName)) return sum + (pa.points || 0);
    if (pa.byName === memberName) return sum + (pa.points || 0);
    return sum;
  }, 0);
}

// Age ceiling for PIN-free kid actions (sign-in eligibility re-checks the
// same bound server-side in /api/auth/quick-login — single source here).
export const PIN_FREE_MAX_AGE = 10;

// One tap, no PIN: under-10 kids complete ASSIGNED chores (never universal/
// snatchable — claims keep their PIN). Missing age fails closed to the PIN
// path. Task 7 routes every kid completion through pendingApproval.
export function completesWithoutPin(
  role: string | undefined,
  age: number | undefined,
  task: Task
): boolean {
  return (
    role === "child" &&
    typeof age === "number" &&
    Number.isFinite(age) &&
    age > 0 &&
    age < PIN_FREE_MAX_AGE &&
    !task.completed &&
    !task.universal &&
    !isSnatchable(task)
  );
}

// Every CHILD completion (any age) lands as done-but-unpaid: the PIN proves
// identity, the parent approves correctness. Adults keep instant earns.
export function completesWithPendingApproval(role: string | undefined, task: Task): boolean {
  return role === "child" && !task.completed;
}

export function tapCompletePending(task: Task, byName: string, nowISO: string, week: string): Task {
  return {
    ...task,
    completed: true,
    completedBy: byName,
    completedAt: nowISO,
    completedInWeek: week,
    pendingApproval: { byName, at: nowISO, points: task.points },
    // A fresh tap supersedes any earlier send-back proof.
    sentBackAt: undefined,
  };
}

// Reversal-aware per-member idempotency: has this member already been paid for
// this task, with no later negative adjust undoing it? (The solo flow used a
// taskId-only check; crew approval needs taskId + member.)
function memberAlreadyPaid(history: Transaction[], taskId: number, member: string): boolean {
  const earns = history.filter(
    (tx) => tx.type === "earn" && tx.taskId === taskId && tx.member === member
  );
  const latest = earns[earns.length - 1];
  if (!latest) return false;
  const reversed = history.some(
    (tx) =>
      tx.taskId === taskId &&
      tx.type === "adjust" &&
      tx.amount < 0 &&
      tx.member === member &&
      tx.timestamp >= latest.timestamp
  );
  return !reversed;
}

export function approvePendingCompletion(
  tasks: Task[],
  weekData: WeekData,
  taskId: number
): { tasks: Task[]; weekData: WeekData } {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !isPendingApproval(task)) return { tasks, weekData };
  const cleared = tasks.map((t) =>
    t.id === taskId ? { ...t, pendingApproval: undefined, sentBackAt: undefined } : t
  );
  const approval = task.pendingApproval!;
  // Crew completions pay every joined member the FULL points, one earn each
  // (idempotency keyed taskId + member). Solo taps pay the single tapper.
  const crewRoster = Array.isArray(approval.crew) && approval.crew.length > 0 ? approval.crew : null;
  const payees = (crewRoster ?? [approval.byName]).filter(Boolean);
  const isCrew = !!crewRoster;

  const sameWeek = task.completedInWeek === weekData.weekStart;
  // B1: the approval record carries the FULL amount the claim stored
  // (base + speed bonus). task.points is the pre-bonus base — never pay it alone.
  const amount = approval.points ?? task.points;
  const pointsMsg = amount > 0 ? ` (+${amount}pts)` : "";
  let next = weekData;
  let paidAny = false;
  for (const owner of payees) {
    if (memberAlreadyPaid(next.history, taskId, owner)) continue;
    next = {
      ...next,
      points: { ...next.points, [owner]: (next.points[owner] || 0) + amount },
    };
    next = addTransaction(
      next,
      "earn",
      amount,
      `${isCrew ? "Crew" : sameWeek ? "Completed" : "Approved"}: ${task.title}${pointsMsg}`,
      owner,
      task.id
    );
    paidAny = true;
  }
  // Nothing to pay (already paid elsewhere) → still clear the pending row.
  if (!paidAny) return { tasks: cleared, weekData };
  return { tasks: cleared, weekData: next };
}

export function sendBackPendingCompletion(tasks: Task[], taskId: number): Task[] {
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !isPendingApproval(task)) return tasks;
  return tasks.map((t) =>
    t.id === taskId
      // sentBackAt is the durable cross-device proof that this tap was
      // REJECTED (no earn tx exists for a send-back) — the snapshot merge
      // uses it to let the clear win over a kid device's stale pending row.
      // A crew send-back also clears every check-in so the crew can redo it.
      ? {
          ...t,
          completed: false,
          completedBy: undefined,
          completedAt: undefined,
          completedInWeek: undefined,
          pendingApproval: undefined,
          sentBackAt: new Date().toISOString(),
          crew:
            isCrewTask(t) && t.crew
              ? {
                  members: t.crew.members.map((m) => ({
                    name: m.name,
                    emoji: m.emoji,
                    joinedAt: m.joinedAt,
                  })),
                  ...(Array.isArray(t.crew.removed) && t.crew.removed.length > 0
                    ? { removed: [...t.crew.removed] }
                    : {}),
                }
              : t.crew,
        }
      : t
  );
}

export function emptyWeekData(startISO?: string): WeekData {
  return {
    weekStart: startISO || localWeekStartISO(),
    points: {},
    streak: {},
    lastActive: {},
    history: [],
  };
}

/**
 * Adopt a server-authoritative weekData (an outbox acknowledgment body, or a
 * pulled snapshot leg) as the truth for the current week.
 *
 * There is deliberately NO history-length heuristic here any more. Once every
 * ledger write is a durable outbox command, a locally recorded earn always has
 * a queued command behind it, so a shorter server ledger is never "the server
 * lost my offline transaction" — it is the server's authoritative state and
 * must win. The only guard left is the week rollover: a strictly OLDER server
 * week is stale (no device has synced since Monday) and must not resurrect last
 * week's points into the fresh week.
 */
export function adoptAuthoritativeWeekData(prev: WeekData, server: WeekData): WeekData {
  const prevStart = String(prev?.weekStart ?? "");
  const serverStart = String(server?.weekStart ?? "");
  if (!serverStart) return prev;
  if (prevStart && serverStart < prevStart) return prev;
  // REPLACE, not merge: a leg the server did not send is the server's answer
  // ("empty"), and keeping the local copy of it would resurrect points the
  // server has already dropped. Each leg is therefore taken from the server
  // when it carries one, and otherwise reset to its canonical empty shape.
  return {
    weekStart: server.weekStart,
    points: isRecord(server.points) ? server.points : {},
    streak: isRecord(server.streak) ? server.streak : {},
    lastActive: isRecord(server.lastActive) ? server.lastActive : {},
    history: Array.isArray(server.history) ? server.history : [],
  };
}

let _txId = Date.now();
function nextTxId(): number {
  return ++_txId + Math.floor(Math.random() * 1000);
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, data: unknown): boolean {
  if (typeof window === "undefined") return true;
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    /* quota exceeded — non-critical */
    return false;
  }
}

export function loadWeekData(): WeekData {
  const stored = loadJSON<WeekData | null>(WEEK_DATA_KEY, null);
  return stored?.weekStart ? stored : emptyWeekData();
}

export function saveWeekData(data: WeekData): void {
  saveJSON(WEEK_DATA_KEY, data);
}

export function addTransaction(
  week: WeekData,
  type: Transaction["type"],
  amount: number,
  description: string,
  member: string,
  taskId?: number,
  appliedBy?: string
): WeekData {
  const tx: Transaction = {
    id: nextTxId(),
    timestamp: new Date().toISOString(),
    member,
    type,
    amount,
    description,
    taskId,
    appliedBy,
  };
  return { ...week, history: [...week.history, tx] };
}

/**
 * Count consecutive days (today back to this week's Monday) on which at
 * least one completion occurred. `allCompletionsThisWeek` MUST already be
 * filtered to the member whose streak is being computed (e.g. via
 * `getThisWeeksCompletedDates(tasks, memberName)`) — this function does not
 * filter by member itself.
 */
export function calculateRealStreak(
  memberName: string,
  week: WeekData,
  allCompletionsThisWeek: string[],
  today: string = localTodayISO()
): number {
  // `today` defaults to the FAMILY-LOCAL calendar day (America/Detroit). The
  // old UTC todayISO() cursor read "tomorrow" every evening 8pm–midnight
  // local, zeroing every streak each night. The optional param keeps the
  // streak scenarios deterministic in tests (pinned dates, no wall clock).
  // Compare DATE STRINGS, not Date instants — date parts compare lexically
  // and are immune to the offset. `monday` is the Monday of the LOCAL week
  // containing `today`, read straight from the canonical helper:
  // `new Date("2026-09-28")` parses as UTC midnight (Sunday evening in
  // Detroit), so walking back from it scoped every streak to the PREVIOUS
  // week, and `mondayOf(...).toISOString()` had the mirror defect east of
  // UTC. weekStartForDate takes the date-only string and does local math from
  // local date parts, so it is correct in every zone.
  const monday = weekStartForDate(today);
  let streak = 0;
  let cursor = today;

  while (cursor >= monday) {
    // `cursor` is a LOCAL day, so the completion's day must be derived in the
    // same zone — `d.split("T")[0]` is its UTC date, which lands on the next
    // (Detroit) or previous (Tokyo) calendar day near midnight and would zero
    // the streak for an evening completion even once the week filter admits it.
    const hasCompletion = allCompletionsThisWeek.some(
      (d) => localDateOf(d) === cursor
    );
    if (!hasCompletion) break;
    streak++;
    const prev = new Date(`${cursor}T00:00:00.000Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursor = prev.toISOString().slice(0, 10);
  }

  return streak;
}

export function regenerateRecurringTasks(tasks: Task[]): Task[] {
  // Local calendar day — the UTC date rolled the clone due to "tomorrow"
  // when regen ran in the evening (8pm–midnight Detroit).
  const now = localTodayISO();
  const monday = localWeekStartISO();

  // Clone sources: recurring tasks completed in a PRIOR week (or with no
  // completedInWeek recorded). Tasks completed THIS week are left untouched —
  // they regen next week.
  const sources = tasks.filter(
    (t) => t.completed && t.recurring && t.completedInWeek !== monday && !isPendingApproval(t)
  );

  // Dedupe by lineage so duplicate completed rows never compound into
  // multiple clones — keep only the first source per lineage.
  const seenLineages = new Set<string>();
  const lineageSources: Task[] = [];
  for (const t of sources) {
    const lineage = `${t.title}|${t.recurring}|${t.universal ? "universal" : t.assignee}`;
    if (seenLineages.has(lineage)) continue;
    seenLineages.add(lineage);
    lineageSources.push(t);
  }

  // The consumed completed sources are removed — their completion record
  // lives in week_data history/archives. Keeping them would re-clone them
  // every week (1→2→4 growth).
  const consumedIds = new Set(sources.map((t) => t.id));
  const remaining = tasks.filter((t) => !consumedIds.has(t.id));

  const clones = lineageSources.map((t) => {
    const cloneId = Date.now() + Math.floor(Math.random() * 100000);
    return {
      ...t,
      id: cloneId,
      completed: false,
      completedBy: undefined,
      completedAt: undefined,
      completedInWeek: undefined,
      // A regenerated clone starts clean — no stale approval/send-back state.
      pendingApproval: undefined,
      sentBackAt: undefined,
      // Crew tasks come back with an empty crew (nobody joined this week yet),
      // size + speed bonus preserved (spec §3).
      crew: isCrewTask(t) ? { members: [] } : t.crew,
      // Universal recurring tasks come back unclaimed — no ghost assignee from last week
      assignee: t.universal ? "All" : t.assignee,
      assigneeEmoji: t.universal ? "🤝" : t.assigneeEmoji,
      due: now,
    };
  });

  return [...remaining, ...clones];
}

export function getThisWeeksCompletedDates(tasks: Task[], memberName?: string, today: string = localTodayISO()): string[] {
  // `monday` is the Monday of the LOCAL week containing `today`, from the
  // canonical helper (a date-only string never round-trips through new Date(),
  // which would read it as UTC midnight) — so a pinned test date scopes its
  // own week, never the real wall clock's, and never the previous week.
  const monday = weekStartForDate(today);
  const now = today;
  return tasks
    .filter(
      (t) =>
        t.completed &&
        t.completedAt &&
        (!memberName || t.completedBy === memberName)
    )
    .map((t) => t.completedAt!)
    // Compare LOCAL calendar days, not UTC ones. `completedAt` is a UTC
    // instant, so `d.slice(0, 10)` is its UTC date and disagrees with the
    // local `monday`/`now` for four hours either side of UTC midnight: in
    // Detroit an evening chore (20:00–24:00 local) serialized as tomorrow and
    // was dropped from the week, while a Sunday-evening chore serialized as
    // Monday and was pulled INTO the new week. `localDateOf` converts the
    // instant to the family timezone, so both comparisons are local-to-local.
    .filter((d) => {
      const day = localDateOf(d);
      return day >= monday && day <= now;
    });
}

export function getThisWeeksCompletedTasks(tasks: Task[]): Task[] {
  const monday = localWeekStartISO();
  const now = localTodayISO();
  return tasks.filter(
    (t) => t.completed && (
      t.completedInWeek === monday ||
      // Unstamped rows: compare LOCAL days. `completedAt` is a UTC instant, and
      // lexically "2026-09-28T14:00:00.000Z" > "2026-09-28", so the old
      // `completedAt <= now` was false for EVERY completion made on the current
      // day — an unstamped task never counted as this week's, on either feed
      // (the Tasks board filter and the kid's "Done today" card).
      (!t.completedInWeek && t.completedAt && localDateOf(t.completedAt) >= monday && localDateOf(t.completedAt) <= now)
    )
  );
}

export function loadTasks(): Task[] {
  return loadJSON<Task[]>(TASKS_STORAGE_KEY, []);
}

export function saveTasks(tasks: Task[]): void {
  saveJSON(TASKS_STORAGE_KEY, tasks);
}

export function loadDeletedTaskIds(): number[] {
  const raw = loadJSON<unknown[]>(DELETED_TASKS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
}

export function saveDeletedTaskIds(ids: number[]): void {
  const unique = [...new Set((ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
  saveJSON(DELETED_TASKS_KEY, unique);
}

// ─── Crew tasks (spec §1/§3) ──────────────────────────────────────────────
// A crew task needs N helpers; every joined member earns the FULL points on
// approval. All crew math lives here (pure) so the claim route, Tasks page,
// KidHome and the snapshot merge share one source of truth.
export function isCrewTask(task: Pick<Task, "crewSize"> | null | undefined): boolean {
  return !!task && typeof task.crewSize === "number" && task.crewSize >= 2;
}

export function crewMembers(task: Pick<Task, "crew"> | null | undefined): CrewMember[] {
  return task?.crew?.members ?? [];
}

export function crewMemberCount(task: Pick<Task, "crew">): number {
  return crewMembers(task).length;
}

export function crewFull(task: Pick<Task, "crewSize" | "crew">): boolean {
  return isCrewTask(task) && crewMembers(task).length >= (task.crewSize as number);
}

export function crewHasMember(task: Pick<Task, "crew">, memberName: string): boolean {
  return crewMembers(task).some((m) => m.name === memberName);
}

export function canJoinCrew(
  task: Pick<Task, "crewSize" | "crew" | "completed">,
  memberName: string
): boolean {
  return (
    !!task &&
    !task.completed &&
    isCrewTask(task) &&
    !crewFull(task) &&
    !crewHasMember(task, memberName)
  );
}

export function crewMemberCheckedIn(task: Pick<Task, "crew">, memberName: string): boolean {
  return crewMembers(task).some((m) => m.name === memberName && !!m.checkedInAt);
}

export function crewCheckinProgress(task: Pick<Task, "crewSize" | "crew">): {
  checkedIn: number;
  total: number;
} {
  const total = typeof task.crewSize === "number" ? task.crewSize : 0;
  return {
    checkedIn: crewMembers(task).filter((m) => !!m.checkedInAt).length,
    total,
  };
}

// True only when the crew is actually full AND every joined member has checked
// in — the parent-approval trigger (spec §3).
export function crewAllCheckedIn(task: Pick<Task, "crewSize" | "crew">): boolean {
  const { checkedIn, total } = crewCheckinProgress(task);
  return total >= 2 && crewMembers(task).length >= total && checkedIn >= total;
}

// Snapshot-merge normalizers. PocketBase coerces an unset number field to 0, so
// a non-crew row returns crewSize:0 / speedBonus:0 while local rows carry
// null/undefined. Without normalizing, EVERY row would look "changed" on every
// sync and the merge would rewrite crew fields forever (spurious tasksChanged →
// constant snapshot pushes). 0 is also semantically "no bonus".
export function normalizeCrewSize(value: unknown): number | null {
  return typeof value === "number" && value >= 2 ? value : null;
}
export function normalizeSpeedBonus(value: unknown): number {
  return typeof value === "number" && value > 0 ? value : 0;
}
export function normalizeCrew(value: unknown): CrewMember[] {
  const members = (value as { members?: unknown } | null | undefined)?.members;
  if (!Array.isArray(members)) return [];
  return members.filter(
    (m): m is CrewMember =>
      !!m && typeof (m as CrewMember).name === "string" && (m as CrewMember).name.length > 0
  );
}
// Removed-member tombstones (see Crew.removed).
export function normalizeCrewRemoved(value: unknown): string[] {
  const removed = (value as { removed?: unknown } | null | undefined)?.removed;
  if (!Array.isArray(removed)) return [];
  return removed.filter((n): n is string => typeof n === "string" && n.length > 0);
}
// Order-independent membership + check-in fingerprint for cheap diffing.
// Includes removed member names so a removal is seen as a real change.
export function crewFingerprint(value: unknown): string {
  const members = normalizeCrew(value)
    .map((m) => `${m.name}:${m.checkedInAt ? 1 : 0}`)
    .sort();
  const removed = normalizeCrewRemoved(value).slice().sort().map((n) => `-${n}`);
  return [...members, ...removed].join("|") || "\u0000empty";
}
// Union by member name: a join seen on either side survives (a cross-device
// join race never drops a member) and check-ins are set-once. Removed members
// (tombstoned by either side) are omitted.
export function unionCrewMembers(a: CrewMember[], b: CrewMember[]): CrewMember[] {
  const byName = new Map<string, CrewMember>();
  for (const m of [...a, ...b]) {
    if (!m?.name) continue;
    const existing = byName.get(m.name);
    if (!existing) {
      byName.set(m.name, { ...m });
      continue;
    }
    const joinedAt =
      existing.joinedAt && m.joinedAt
        ? existing.joinedAt <= m.joinedAt
          ? existing.joinedAt
          : m.joinedAt
        : existing.joinedAt || m.joinedAt;
    byName.set(m.name, {
      name: m.name,
      emoji: existing.emoji || m.emoji,
      joinedAt,
      checkedInAt: existing.checkedInAt || m.checkedInAt,
    });
  }
  return [...byName.values()];
}

/**
 * Pure merge of a /api/tasks/sync snapshot into local task/week state — the
 * same guards the Tasks page's restoreFromSnapshot uses: adopt only richer/
 * longer server state (new tasks by id-or-title, a different or richer week),
 * never clobber local rows. A no-change refresh returns the inputs unchanged
 * so callers can skip their persistence effects.
 */
export function mergeTasksSnapshot(
  currentTasks: Task[],
  currentWeekData: WeekData,
  snapshot: any
): { tasks: Task[]; weekData: WeekData; tasksChanged: boolean; weekChanged: boolean; deletedTaskIds: number[] } {
  let tasks = currentTasks;
  let weekData = currentWeekData;
  let tasksChanged = false;
  let weekChanged = false;
  if (!snapshot) return { tasks, weekData, tasksChanged, weekChanged, deletedTaskIds: loadDeletedTaskIds() };

  let restored: any[] = [];
  if (Array.isArray(snapshot.tasks) && snapshot.tasks.length) {
    restored = snapshot.tasks.map((t: any) => ({
      ...t,
      // Preserve the real numeric id and completion attribution (the same
      // fields restoreFromSnapshot guards — regenerating ids broke targeting).
      id: typeof t.id === "number" ? t.id : Number(t.id) || Date.now() + Math.floor(Math.random() * 100000),
      assignee: t.assignee || t.assigned || "All",
      assigneeEmoji: t.assigneeEmoji || "👤",
      completed: t.completed || false,
      completedBy: t.completedBy ?? undefined,
      completedAt: t.completedAt ?? undefined,
      completedInWeek: t.completedInWeek ?? undefined,
      pendingApproval: (t as any).pendingApproval ?? undefined,
      sentBackAt: (t as any).sentBackAt ?? undefined,
      // Normalize crew fields on fresh rows too (PB returns 0 for unset
      // numbers; 0 is not a valid crew size / speed bonus).
      crewSize: normalizeCrewSize((t as any).crewSize),
      crew: normalizeCrewSize((t as any).crewSize)
        ? { members: normalizeCrew((t as any).crew), removed: normalizeCrewRemoved((t as any).crew) }
        : null,
      speedBonus: normalizeSpeedBonus((t as any).speedBonus) || undefined,
    }));
    // Fresh = rows that match NOTHING known: not by id against local, not by
    // title against local, and not against a row already accepted from THIS
    // snapshot. The within-snapshot guard matters because a blob can carry
    // the same logical row twice (an id-less row gets a regenerated id at
    // :396, so two copies never share an id to collide on) — without it both
    // copies land and the receiving device shows duplicate chores with
    // colliding React keys.
    // A task is the SAME logical row when the id matches, OR the title AND
    // assignee match. Two members can share a chore title ("Walking Dogs" for
    // Bailey, Emily and Jasmine) — title-only dedupe silently dropped all but
    // the first; the same title on the SAME assignee is still one duplicate.
    const sameLogical = (a: any, b: any) =>
      a.id === b.id ||
      (String(a.title ?? "") === String(b.title ?? "") &&
        String(a.assignee ?? "") === String(b.assignee ?? ""));
    const fresh: any[] = [];
    for (const t of restored) {
      const matchesLocal = currentTasks.some((p: any) => sameLogical(p, t));
      const matchesAccepted = fresh.some((f: any) => sameLogical(f, t));
      if (!matchesLocal && !matchesAccepted) fresh.push(t);
    }
    if (fresh.length) {
      tasks = [...currentTasks, ...fresh];
      tasksChanged = true;
    }
  }

  // Adopt completion/pending field changes on KNOWN rows: a kid's tap on the
  // kitchen phone must land on a parent's device even though the row id
  // already exists locally. A remote clear only wins when it carries PROOF —
  // the snapshot's weekData carries the earn tx (approval happened elsewhere),
  // or the snapshot row is stamped sentBackAt that post-dates the local row's
  // own completion stamp (a send-back happened elsewhere, AFTER this tap) —
  // otherwise a stale snapshot would wipe a fresh local tap. The rule covers
  // any locally completed row: pending taps AND classic PIN-completed (paid)
  // completions, whose earn lives only on the paying device.
  const byId = new Map(restored.map((t: any) => [t.id, t]));
  let merged = tasks;
  for (const snapRow of byId.values()) {
    const local = merged.find((p: any) => p.id === snapRow.id);
    if (!local) continue;
    const snapshotPending = (snapRow as any).pendingApproval ?? undefined;
    const localPending = (local as any).pendingApproval ?? undefined;
    const pendingDiffers =
      JSON.stringify(snapshotPending ?? null) !== JSON.stringify(localPending ?? null);
    const completionDiffers =
      !!snapRow.completed !== !!local.completed ||
      (snapRow.completedBy ?? undefined) !== (local.completedBy ?? undefined) ||
      (snapRow.completedAt ?? undefined) !== (local.completedAt ?? undefined) ||
      (snapRow.completedInWeek ?? undefined) !== (local.completedInWeek ?? undefined);

    const snapCrewSize = normalizeCrewSize((snapRow as any).crewSize);
    const snapSpeed = normalizeSpeedBonus((snapRow as any).speedBonus);
    const crewDiffers =
      snapCrewSize !== normalizeCrewSize((local as any).crewSize) ||
      snapSpeed !== normalizeSpeedBonus((local as any).speedBonus) ||
      crewFingerprint((snapRow as any).crew) !== crewFingerprint((local as any).crew);

    if (!pendingDiffers && !completionDiffers && !crewDiffers) continue;
    const localDone = !!local.completed || !!localPending;
    const remoteClearsPending = !!localPending && !snapshotPending;
    const remoteReopens = !!local.completed && !snapRow.completed;
    // 2026-09-23 review: a locally SENT-BACK row (not done, durable
    // sentBackAt — an OFFLINE send-back whose POST never landed) must not be
    // re-pended by a snapshot row whose tap the send-back POST-DATES. The
    // kid's device hasn't pulled the clear yet, so the snapshot still shows
    // the old pending; without this gate the parent's own next pull adopted
    // it back into the queue — the send-back silently undid itself. (A
    // remote pending NEWER than the stamp is a genuine re-claim and wins.)
    if (!localDone && snapshotPending && (local as any).sentBackAt) {
      const localSentBackTs = Date.parse(String((local as any).sentBackAt));
      const remoteTapTs = Date.parse(String((snapshotPending as any)?.at ?? ""));
      if (!Number.isNaN(localSentBackTs) && (Number.isNaN(remoteTapTs) || localSentBackTs >= remoteTapTs)) {
        continue;
      }
    }
    if (localDone && (remoteClearsPending || remoteReopens)) {
      const paidElsewhere = (snapshot.weekData?.history || []).some(
        (tx: any) => tx.type === "earn" && tx.taskId === snapRow.id
      );
      // Timestamp gate: a send-back stamp only proves the reopen when it does
      // NOT pre-date the local row's own completion stamp — `pendingApproval.at`
      // for a pending tap (a legit send-back always happens AFTER the tap that
      // made it pending; the kid's fresh re-claim post-dates the send-back and
      // a pre-re-claim stamp is stale proof), falling back to `completedAt`
      // for classic paid rows; a local row carrying neither stamp keeps the
      // old accept-the-stamp behavior. Without this gate a send-back → kid
      // re-claim sequence landing inside the claimant's push window let a
      // stale stamp wipe the fresh row, and the pushed wipe then 409'd every
      // later re-claim against the server's completed:true row.
      const sentBackAt = (snapRow as any).sentBackAt;
      const localDoneAt = Date.parse((local as any).pendingApproval?.at ?? local.completedAt ?? "");
      const sentBackElsewhere =
        !!sentBackAt &&
        (Number.isNaN(localDoneAt) || Date.parse(String(sentBackAt)) >= localDoneAt);
      if (!paidElsewhere && !sentBackElsewhere) continue;
    }
    merged = merged.map((p: any) =>
      p.id === snapRow.id
        ? {
            ...p,
            crewSize: snapCrewSize,
            crew: snapCrewSize
              ? (() => {
                  const removed = [...new Set([
                    ...normalizeCrewRemoved((p as any).crew),
                    ...normalizeCrewRemoved((snapRow as any).crew),
                  ])];
                  const members = unionCrewMembers(
                    normalizeCrew((p as any).crew),
                    normalizeCrew((snapRow as any).crew)
                  ).filter((m) => !removed.includes(m.name));
                  return { members, ...(removed.length ? { removed } : {}) };
                })()
              : null,
            speedBonus: snapSpeed > 0 ? snapSpeed : undefined,
            completed: snapRow.completed,
            completedBy: snapRow.completedBy ?? undefined,
            completedAt: snapRow.completedAt ?? undefined,
            completedInWeek: snapRow.completedInWeek ?? undefined,
            pendingApproval: snapshotPending,
            sentBackAt: (snapRow as any).sentBackAt ?? undefined,
          }
        : p
    );
    tasksChanged = true;
  }
  tasks = merged;

  if (snapshot.weekData?.weekStart) {
    const snapWk = snapshot.weekData;
    // A snapshot week OLDER than the local one is stale — no device has synced
    // since the Monday rollover — and adopting it would resurrect last week's
    // points into the fresh week (which the week-reset interval then archives
    // and wipes). ISO dates compare lexically, so that is a string compare.
    const adoptable = currentWeekData.weekStart !== snapWk.weekStart
      ? String(snapWk.weekStart) >= String(currentWeekData.weekStart)
      : true;
    // Otherwise the server leg IS the ledger and it wins outright, with NO
    // history-length comparison: every write is a durable command, so a locally
    // held transaction always has a queued command behind it, and a shorter
    // server ledger is the server's answer — never evidence of a lost local row.
    //
    // A no-op pull must report `weekChanged: false` and hand back the SAME
    // reference it was given, so a 60s refresh that changed nothing does not
    // churn the store or look like an adoption.
    if (adoptable) {
      const next = { ...currentWeekData, ...snapWk };
      if (JSON.stringify(next) !== JSON.stringify(currentWeekData)) {
        weekData = next;
        weekChanged = true;
      }
    }
  }

  // Tombstones: union every removal this device knows about (local + snapshot)
  // and drop those rows. The merge is otherwise add-only, so without this a
  // chat-initiated delete would be re-pushed forever by any device that still
  // holds the row.
  const mergedDeleted = [
    ...new Set([...loadDeletedTaskIds(), ...((snapshot.deletedTaskIds || []) as any[]).map((n) => Number(n))]),
  ].filter((n) => Number.isFinite(n));
  if (mergedDeleted.length) {
    const before = tasks.length;
    tasks = tasks.filter((t) => !mergedDeleted.includes(Number(t.id)));
    if (tasks.length !== before) tasksChanged = true;
  }

  return { tasks, weekData, tasksChanged, weekChanged, deletedTaskIds: mergedDeleted };
}

/**
 * The ONE config-leg adoption seam for the rewards, penalties and weekly-prizes
 * catalogs. It accepts a config snapshot leg — a whole task snapshot, or just
 * the one leg a caller read — and merges each leg it finds by LAST-WRITE-WINS
 * on that leg's own stamp — never "a longer list wins", which is delete-blind:
 * a parent's delete is a SHORTER, NEWER list, so a length heuristic resurrects
 * the row it just removed.
 *
 * Two rules make that safe, and both are load-bearing:
 *  - only a STRICTLY-NEWER stamp wins, and a leg with no stamp never wins, so a
 *    legacy unstamped snapshot can never resurrect a deleted row;
 *  - the winning stamp is carried through VERBATIM (never re-stamped to "now"),
 *    so this device stops looking "edited" and a no-op refresh cannot block the
 *    next real server edit.
 *
 * The rewards leg needs this in particular because without it the reward catalog
 * was PULL-only: a device that never wrote a config command could never learn
 * the server's list. The weekly-prizes leg uses the identical contract.
 *
 * Callers: applyTasksSnapshotToStores — which the 60s refresh (db.refreshCaches)
 * and the outbox's snapshot proof (adoptTaskOutboxSnapshot) both route through —
 * the Tasks page's own restoreFromSnapshot pull, and WeeklyPrizesCard, which
 * hands it only the weekly-prizes leg of a config read. Returns whether anything
 * was adopted.
 */
export function applyTaskConfigSnapshotToStores(snapshot: any): boolean {
  if (!snapshot) return false;
  let changed = false;
  if (
    Array.isArray(snapshot.rewards) &&
    typeof snapshot.rewardsUpdatedAt === "string" &&
    snapshot.rewardsUpdatedAt > readRewardsStamp()
  ) {
    writeRewardsStamp(snapshot.rewardsUpdatedAt);
    saveRewards(snapshot.rewards);
    changed = true;
  }
  if (
    Array.isArray(snapshot.penalties) &&
    typeof snapshot.penaltiesUpdatedAt === "string" &&
    snapshot.penaltiesUpdatedAt > readPenaltiesStamp()
  ) {
    writePenaltiesStamp(snapshot.penaltiesUpdatedAt);
    savePenalties(snapshot.penalties);
    changed = true;
  }
  if (
    Array.isArray(snapshot.weeklyPrizes) &&
    typeof snapshot.weeklyPrizesStamp === "string" &&
    snapshot.weeklyPrizesStamp > readWeeklyPrizesStamp()
  ) {
    writeWeeklyPrizesStamp(snapshot.weeklyPrizesStamp);
    saveWeeklyPrizes(snapshot.weeklyPrizes);
    changed = true;
  }
  return changed;
}

/**
 * Store-level seam for the 60s refresh loop (db.refreshCaches): the caller
 * reads /api/tasks/sync and hands the snapshot here, which merges it into the
 * same localStorage stores loadTasks()/loadWeekData() read — so KidHome's
 * dataVersion listener and Home's widgets actually see another device's
 * tasks when they re-read on `consuela-data-refreshed`. The three config legs
 * ride along through applyTaskConfigSnapshotToStores. Returns whether
 * anything changed.
 */
export function applyTasksSnapshotToStores(snapshot: any): boolean {
  if (!snapshot) return false;
  const { tasks, weekData, tasksChanged, weekChanged, deletedTaskIds } = mergeTasksSnapshot(
    loadTasks(),
    loadWeekData(),
    snapshot
  );
  if (tasksChanged) saveTasks(tasks);
  if (weekChanged) saveWeekData(weekData);
  if (deletedTaskIds?.length) saveDeletedTaskIds(deletedTaskIds);
  return tasksChanged || weekChanged || applyTaskConfigSnapshotToStores(snapshot);
}

export function loadRewards<T>(fallback: T): T {
  return loadJSON(REWARDS_KEY, fallback);
}

export function saveRewards<T>(rewards: T): void {
  saveJSON(REWARDS_KEY, rewards);
}

// The rewards last-write-wins stamp lives under the key kid-store already
// uses, so the two modules always agree on how fresh this device's catalog is.
export const REWARDS_STAMP_KEY = "consuela-rewards-updatedAt";

/**
 * Reads a last-write-wins stamp. These stamps are compared with `>` against
 * another ISO string, so the STORED FORM MATTERS: a JSON-quoted value starts
 * with `"` (0x22) and therefore sorts BEFORE every bare ISO, which makes a
 * quoted stamp look permanently stale and lets an older snapshot win. This key
 * is written raw (as kid-store wrote it), and the reader still tolerates a
 * quoted value left behind by an earlier JSON writer instead of silently
 * reporting "no stamp".
 */
function readStampText(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "string" ? parsed : raw;
    } catch {
      return raw;
    }
  } catch {
    return "";
  }
}

/** Writes a last-write-wins stamp as the bare ISO string readStampText compares. */
function writeStampText(key: string, stamp: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, stamp);
  } catch {}
}

export function readRewardsStamp(): string {
  return readStampText(REWARDS_STAMP_KEY);
}

export function writeRewardsStamp(stamp: string): void {
  writeStampText(REWARDS_STAMP_KEY, stamp);
}

export function loadPenalties<T>(fallback: T): T {
  return loadJSON(PENALTIES_KEY, fallback);
}

export function savePenalties<T>(penalties: T): void {
  saveJSON(PENALTIES_KEY, penalties);
}

export const PENALTIES_STAMP_KEY = "consuela-penalties-updatedAt";

export function readPenaltiesStamp(): string {
  return loadJSON<string>(PENALTIES_STAMP_KEY, "");
}

export function writePenaltiesStamp(stamp: string): void {
  saveJSON(PENALTIES_STAMP_KEY, stamp);
}

// ─── Weekly prizes — the top-3 finishers' rewards for the week race ────────
// Same localStorage + last-write-wins-stamp idiom as the rewards catalog
// (mirrors kid-store's touchRewardsStamp/readRewardsStamp on this module's
// private loadJSON/saveJSON helpers).
export const WEEKLY_PRIZES_KEY = "consuela-weekly-prizes";
const WEEKLY_PRIZES_STAMP_KEY = "consuela-weekly-prizes-stamp";

export const DEFAULT_WEEKLY_PRIZES: WeeklyPrize[] = [
  { id: "prize-1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" },
  { id: "prize-2", rank: 2, emoji: "🥈", text: "Chooses the dessert night" },
  { id: "prize-3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
];

export function loadWeeklyPrizes(): WeeklyPrize[] {
  return loadJSON<WeeklyPrize[]>(WEEKLY_PRIZES_KEY, DEFAULT_WEEKLY_PRIZES);
}
export function saveWeeklyPrizes(prizes: WeeklyPrize[]): boolean {
  return saveJSON(WEEKLY_PRIZES_KEY, prizes);
}
export function prizeForRank(prizes: WeeklyPrize[], rank: number): WeeklyPrize | undefined {
  return prizes.find((p) => p.rank === rank);
}
export function touchWeeklyPrizesStamp(): boolean {
  return saveJSON(WEEKLY_PRIZES_STAMP_KEY, new Date().toISOString());
}
export function readWeeklyPrizesStamp(): string {
  return loadJSON<string>(WEEKLY_PRIZES_STAMP_KEY, "");
}
// Carry an adopted snapshot's stamp through as the local stamp (the list is
// now this device's truth AS OF that stamp — re-stamping "now" would make a
// no-op refresh look like a fresh local edit and block newer server state).
export function writeWeeklyPrizesStamp(stamp: string): void {
  saveJSON(WEEKLY_PRIZES_STAMP_KEY, stamp);
}

// ─── Race gap — "You're 45 pts from 🥉" podium-gap math (pure) ─────────────
export interface RaceGap {
  rank: number | null;
  onPodium: boolean;
  gapToPodium: number | null;
  leader: { name: string; points: number } | null;
}
export function raceGap(memberName: string, pointsMap: Record<string, number>, maxPrizeRank = 3): RaceGap {
  const entries = Object.entries(pointsMap).map(([name, points]) => ({ name, points: points || 0 }));
  const sorted = entries.sort((a, b) => b.points - a.points);
  const ntp = sorted.filter((e) => e.points > 0);
  const leader = ntp[0] || null;
  const mine = entries.find((e) => e.name === memberName);
  const myPoints = mine?.points || 0;
  if (ntp.length === 0 || myPoints === 0)
    return { rank: null, onPodium: false, gapToPodium: ntp.length ? ntp[Math.min(maxPrizeRank, ntp.length) - 1].points - myPoints : null, leader };
  // competition rank: 1 + count of members with strictly more points
  const rank = 1 + ntp.filter((e) => e.points > myPoints).length;
  const cutoffRank = Math.min(maxPrizeRank, ntp.length);
  const podiumThresholdHolder = ntp.filter((e, i) => (1 + ntp.filter((o) => o.points > e.points).length) === cutoffRank)[0];
  const onPodium = rank <= maxPrizeRank;
  return {
    rank, onPodium, leader,
    gapToPodium: onPodium ? null : (podiumThresholdHolder ? podiumThresholdHolder.points - myPoints : null),
  };
}

export function getArchivedWeeks(): WeekArchive {
  return loadJSON<WeekArchive>(ARCHIVE_KEY, {});
}

// The universal-task "Claim for" select must default to WHOEVER IS SIGNED IN —
// a kid completing an "Up for grabs" task types their own PIN, and verifying
// that PIN against the wrong member reads to them as "your PIN is wrong".
// Falls back to the first non-pet member for guests/unknown names; pets can
// never claim, so they're excluded from matching and from the fallback.
export function pickDefaultClaimMember(
  members: { name?: string; fullName?: string; role?: string }[],
  signedInName?: string | null
): string {
  const nonPets = (members || []).filter((m) => m.role !== "pet");
  const first = (v?: string) => (v || "").trim().split(" ")[0].toLowerCase();
  const target = first(signedInName || "");
  if (target) {
    const mine = nonPets.find((m) => first(m.fullName) === target || first(m.name) === target);
    if (mine) return mine.fullName || mine.name || "";
  }
  return nonPets[0]?.fullName || nonPets[0]?.name || "";
}

// Resolve an auth/session name to the roster-resolved FULL name — the same
// ledger key the classic PIN path credits (normalizeName on the Tasks page).
// Matching mirrors pickDefaultClaimMember: exact name/fullName, then
// first-name-insensitive; pets are excluded (they can never earn points).
// Unknown names pass through untouched — never invent a member.
export function resolveMemberName(
  members: { name?: string; fullName?: string; role?: string }[],
  rawName?: string | null
): string {
  const raw = (rawName || "").trim();
  if (!raw) return rawName || "";
  const pool = (members || []).filter((m) => m.role !== "pet");
  const first = (v?: string) => (v || "").trim().split(" ")[0].toLowerCase();
  const target = first(raw);
  const exact = pool.find((m) => m.fullName === raw || m.name === raw);
  if (exact) return exact.fullName || exact.name || raw;
  const mine = pool.find((m) => first(m.fullName) === target || first(m.name) === target);
  if (mine) return mine.fullName || mine.name || raw;
  return raw;
}

export function getMemberAllTimePoints(
  memberName: string,
  currentWeek: WeekData
): number {
  const archive = getArchivedWeeks();
  let total = currentWeek.points[memberName] || 0;
  for (const week of Object.values(archive)) {
    total += week.points[memberName] || 0;
  }
  return total;
}

export function getMemberAllTimeCompletions(
  memberName: string,
  tasks: Task[],
  currentWeek: WeekData
): number {
  const archive = getArchivedWeeks();
  const thisWeekCount = tasks.filter(
    (t) => t.completed && t.completedBy === memberName && (
      t.completedInWeek === currentWeek.weekStart ||
      (!t.completedInWeek && t.completedAt && t.completedAt >= currentWeek.weekStart)
    )
  ).length;

  let pastCompletions = 0;
  for (const week of Object.values(archive)) {
    pastCompletions += week.history.filter(
      (tx) => tx.member === memberName && tx.type === "earn"
    ).length;
  }

  return pastCompletions + thisWeekCount;
}

export function getMemberAllTimeStreak(
  memberName: string,
  currentWeek: WeekData,
  currentStreak: number
): number {
  const archive = getArchivedWeeks();
  const weeks = Object.values(archive).sort(
    (a, b) => b.weekStart.localeCompare(a.weekStart)
  );

  for (const week of weeks) {
    if (week.streak[memberName] && week.streak[memberName] >= 7) {
      return currentStreak;
    }
  }
  return currentStreak;
}

const PREV_RANKS_KEY = "consuela-previous-ranks";

export function getDaysUntilWeekReset(): number {
  // Days until the NEXT Monday, day-of-week math (not date-instant deltas —
  // the old mondayOf(now + 7d) skipped a full week on Sundays: next Monday is
  // 1 day away, not 7-8). Sunday → 1 ("resets tomorrow"); Tuesday..Sunday →
  // 6..1.
  //
  // Monday must be 7, NOT 0: the week runs Monday 00:00 → Sunday 23:59, so a
  // fresh week STARTS on Monday — the reset is a full week away. The old
  // `(8 - day) % 7` collapsed Monday to 0, which every surface rendered as
  // "Resets tonight!" on the one day the race had just begun.
  const days = (8 - new Date().getDay()) % 7;
  return days === 0 ? 7 : days;
}

export function getPreviousWeekRanks(): Record<string, number> {
  return loadJSON<Record<string, number>>(PREV_RANKS_KEY, {});
}

export async function loadPreviousWeekRanksMerged(
  currentWeekStart: string = localWeekStartISO(),
): Promise<Record<string, number>> {
  try {
    const rows = await db.listArchivedWeeks();
    const latest = (Array.isArray(rows) ? rows : [])
      .filter((row: any) => typeof row?.weekStart === "string" && row.weekStart < currentWeekStart)
      .sort((left: any, right: any) => left.weekStart.localeCompare(right.weekStart))
      .at(-1);
    if (!latest) return getPreviousWeekRanks();
    const parsed = typeof latest.points === "string"
      ? JSON.parse(latest.points) as unknown
      : latest.points;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return getPreviousWeekRanks();
    }
    const points = Object.entries(parsed as Record<string, unknown>)
      .map(([member, value]) => ({ member, points: Number(value) || 0 }))
      .filter((entry) => entry.points > 0);
    const ranks: Record<string, number> = {};
    for (const entry of points) {
      ranks[entry.member] = 1 + points.filter((other) => other.points > entry.points).length;
    }
    saveJSON(PREV_RANKS_KEY, ranks);
    return ranks;
  } catch {
    return getPreviousWeekRanks();
  }
}

export function saveCurrentWeekRanksForNextWeek(entries: { name: string; rank: number }[]): void {
  const ranks: Record<string, number> = {};
  for (const e of entries) {
    ranks[e.name] = e.rank;
  }
  saveJSON(PREV_RANKS_KEY, ranks);
}

export function getGapMessage(currentEntry: { points: number; rank: number }, aheadEntry: { points: number; name: string } | undefined): string {
  if (!aheadEntry) return "";
  const gap = aheadEntry.points - currentEntry.points;
  if (gap <= 0) return "";
  return `${gap} pts behind ${aheadEntry.name.split(" ")[0]}`;
}

export function getDailyQuests(memberName: string, tasks: Task[]): Task[] {
  const myPending = tasks.filter(t => !t.completed && (t.assignee === memberName || t.universal));
  const easyWins = myPending.filter(t => t.points <= 10).slice(0, 2);
  const highValue = myPending.filter(t => t.points > 10).slice(0, 1);
  return [...easyWins, ...highValue].slice(0, 3);
}

export function needsStreakSave(memberName: string, week: WeekData, tasks: Task[]): boolean {
  const streak = week.streak[memberName] || 0;
  if (streak < 2) return false;
  // Local calendar day — with the UTC date this nag fired every evening
  // ("no completion tomorrow" → banner begging a save the kid already earned).
  const today = localTodayISO();
  const completedToday = tasks.some(
    t => t.completed && t.completedBy === memberName && t.completedAt && t.completedAt.split("T")[0] === today
  );
  return !completedToday;
}

export function loadFamilyGoal(): FamilyGoal | null {
  return loadJSON<FamilyGoal | null>(FAMILY_GOAL_KEY, null);
}

export function saveFamilyGoal(goal: FamilyGoal): void {
  saveJSON(FAMILY_GOAL_KEY, goal);
}

export function getFamilyGoalProgress(weekData: WeekData, goal: FamilyGoal | null): number {
  if (!goal) return 0;
  const total = Object.values(weekData.points).reduce((a, b) => a + b, 0);
  return Math.min(100, Math.round((total / goal.targetPoints) * 100));
}

export function loadHallOfFame(): HallOfFameEntry[] {
  return loadJSON<HallOfFameEntry[]>(HALL_OF_FAME_KEY, []);
}

export function saveHallOfFame(entries: HallOfFameEntry[]): void {
  saveJSON(HALL_OF_FAME_KEY, entries);
}

/**
 * Enshrine a finished week's podium (rank ≤ 3) in the Hall of Fame, freezing
 * each finisher's prize text at rollover time (`prizeForRank(prizes, rank)` —
 * prizes is defaulted so legacy 2-arg callers keep working; omit the `prize`
 * key entirely when no prize matches the rank).
 *
 * Idempotent per `member + weekStart`: a re-run (the 60s interval and the
 * mount backfill can both fire for the same week) never duplicates and never
 * overwrites — the first enshrinement stays.
 *
 * The hall keeps the latest 12 DISTINCT weekStarts (a week can hold up to 3
 * entries — 36 rows max), dropping the oldest weeks first, in ascending
 * weekStart append order.
 */
export function archiveWeekWinner(
  entries: { name: string; emoji: string; points: number; rank: number }[],
  weekStart: string,
  prizes: WeeklyPrize[] = loadWeeklyPrizes(),
): void {
  if (entries.length === 0) return;
  const hall = loadHallOfFame();
  for (const entry of entries) {
    if (entry.rank > 3) continue;
    if (hall.some((h) => h.member === entry.name && h.weekStart === weekStart)) continue;
    const record: HallOfFameEntry = {
      member: entry.name,
      emoji: entry.emoji,
      weekStart,
      points: entry.points,
      rank: entry.rank,
    };
    const prize = prizeForRank(prizes, entry.rank)?.text;
    if (prize !== undefined) record.prize = prize;
    hall.push(record);
  }
  // Trim to the latest 12 distinct weekStarts (never a raw 12-entry slice —
  // that would mangle weeks). weekStarts are ISO dates, so lexicographic
  // sort is chronological; filtering preserves the per-week append order.
  const distinctWeeks = [...new Set(hall.map((h) => h.weekStart))].sort();
  const keptWeeks = new Set(distinctWeeks.slice(-12));
  const trimmed = hall.filter((h) => keptWeeks.has(h.weekStart));
  saveHallOfFame(trimmed);
}

/**
 * The ceremony check: does this member have a top-3 week win with a prize
 * that hasn't been celebrated yet? Returns the entry to celebrate, or null.
 * Exact full-name match (`member` stores full names), rank ≤ 3, a non-empty
 * string prize, and `celebrated !== true`. If the member stacked wins across
 * weeks (nobody claimed the ceremony), the NEWEST weekStart wins — ISO dates
 * compare lexically.
 */
export function uncelebratedWinFor(
  hall: HallOfFameEntry[],
  memberName: string,
): HallOfFameEntry | null {
  let best: HallOfFameEntry | null = null;
  for (const entry of hall) {
    if (entry.member !== memberName) continue;
    if (entry.rank > 3) continue;
    if (typeof entry.prize !== "string" || entry.prize.length === 0) continue;
    if (entry.celebrated === true) continue;
    if (best === null || entry.weekStart > best.weekStart) best = entry;
  }
  return best;
}

/**
 * The ceremony claim: mark one member's win entry (`member + weekStart`) as
 * celebrated and persist. Re-reads the hall so a concurrent enshrinement on
 * another device isn't clobbered. Silently no-ops when the entry is absent
 * (already trimmed away, or never won that week).
 */
export function markWinCelebrated(memberName: string, weekStart: string): void {
  const hall = loadHallOfFame();
  const match = hall.find((h) => h.member === memberName && h.weekStart === weekStart);
  if (!match) return;
  match.celebrated = true;
  saveHallOfFame(hall);
}

// === emptyTask factory (exported for tasks page + tests) ===

export function emptyTask(firstMember?: { name?: string; emoji?: string }): Task {
  return {
    id: Date.now(),
    title: "",
    assignee: firstMember?.name ?? "",
    assigneeEmoji: firstMember?.emoji ?? "",
    due: new Date().toISOString().split("T")[0],
    points: 0,
    recurring: null,
    category: "chores",
    completed: false,
    priority: "medium",
    universal: false,
    stealable: false,
    crewSize: null,
    crew: null,
  };
}

// === PocketBase sync helpers ===
//
// The browser's structured whole-body push family is GONE: every member of it
// (the per-collection task/week/archive/reward/penalty/prize/hall writers and the
// batch helper that fanned them out) plus the `SyncOutcome` plumbing were
// retired. Task, ledger and points state is server-owned; the browser only
// caches it and asks through the command routes + the durable outbox.
// `tests/unit/task-normal-writes-disabled.test.ts` and
// `tests/unit/task-no-browser-writes.test.ts` pin the absence by name — keep
// this note free of the retired identifiers so it cannot read as a call site.
// The one surviving member of that family is the family-goal (non-task) write
// below.

/**
 * Persist a finished week into PocketBase's `week_archive` collection exactly
 * once. The archive step used to write only `week_data`, so `week_archive`
 * stayed empty and the assistant's `get_past_weeks` always returned nothing.
 * Idempotent per `weekStart` — a second rollover (or the 5s structured sync
 * re-running) never duplicates the row. Never throws: a PB failure degrades
 * silently so the rollover/sync loop can't crash (the next cycle retries).
 *
 * The `listArchivedWeeks` pre-read below is only a cheap fast path (it avoids
 * a write round trip in the common case). It is NOT the duplicate guarantee:
 * production read adapters resolve `[]` on failure rather than rejecting, so
 * the real guarantee lives in `db.archiveWeek`, which upserts by `weekStart`.
 *
 * Returns whether a row was written. A write that silently fails (adapters
 * return `null`) reports `false` — never a false "wrote it".
 *
 * `existingWeekStarts` lets a batch caller share one read; when omitted the
 * helper reads the archive itself.
 */
export async function archiveWeekIfMissing(
  weekData: WeekData,
  existingWeekStarts?: Set<string>
): Promise<boolean> {
  if (!weekData?.weekStart) return false;
  try {
    const existing =
      existingWeekStarts ??
      new Set(
        ((await db.listArchivedWeeks()) || []).map((r: any) => String(r?.weekStart))
      );
    if (existing.has(weekData.weekStart)) return false;
    const row = await db.archiveWeek({
      weekStart: weekData.weekStart,
      archivedAt: new Date().toISOString(),
      points: weekData.points,
      streak: weekData.streak,
      history: weekData.history,
    });
    if (!row) return false;
    existing.add(weekData.weekStart);
    return true;
  } catch {
    return false;
  }
}

export async function syncFamilyGoalToPB(goal: FamilyGoal | null): Promise<void> {
  if (goal) {
    await db.upsertFamilyGoal({
      title: goal.title,
      emoji: goal.emoji,
      targetPoints: goal.targetPoints,
      reward: goal.reward,
      weekStart: goal.weekStart,
      active: true,
    }).catch(() => {});
  }
}

/**
 * The PB→local hall downlink: read PocketBase's `hall_of_fame` rows
 * (best-effort — a failed read degrades to the local hall) and treat the SERVER
 * as the authority. The list is keyed by `member + weekStart`; malformed rows
 * are skipped rather than adopted. When the server answered with at least one
 * row, its list replaces the local copy and is persisted with `saveHallOfFame()`
 * — points/emoji/rank/prize and the `celebrated` ceremony flag all come from
 * the server, because the enshrinement and the `/api/hall-of-fame/celebrate`
 * claim are both server-owned. An empty (or unreadable) server read keeps the
 * local hall so a transient outage never blanks the board.
 */
export async function loadHallOfFameMerged(): Promise<HallOfFameEntry[]> {
  const local = loadHallOfFame();
  let remote: any[];
  try {
    const rows = await db.selectHallOfFame();
    remote = Array.isArray(rows) ? rows : [];
  } catch {
    return local;
  }
  const byKey = new Map<string, HallOfFameEntry>();
  for (const row of remote) {
    if (!row || typeof row.member !== "string" || !row.member) continue;
    if (typeof row.weekStart !== "string" || !row.weekStart) continue;
    const key = `${row.member}\u0000${row.weekStart}`;
    const existing = byKey.get(key);
    const entry: HallOfFameEntry = {
      member: row.member,
      emoji: typeof row.emoji === "string" ? row.emoji : "🏅",
      weekStart: row.weekStart,
      points: typeof row.points === "number" ? row.points : 0,
      rank: typeof row.rank === "number" ? row.rank : 1,
      ...(typeof row.prize === "string" && row.prize ? { prize: row.prize } : {}),
      ...(row.celebrated === true || existing?.celebrated === true ? { celebrated: true } : {}),
    };
    byKey.set(key, entry);
  }
  if (byKey.size === 0) return local;
  const server = [...byKey.values()];
  saveHallOfFame(server);
  return server;
}

export function getWeekGraph(memberName: string, weekData: WeekData): { day: string; points: number }[] {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return days.map(day => ({
    day,
    points: weekData.history
      .filter(tx => tx.member === memberName && tx.type === "earn" && new Date(tx.timestamp).toLocaleDateString("en-US", { weekday: "short" }) === day)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
  }));
}

/** Crew close modes (spec 2026-09-29). Null = absent-or-invalid input;
 *  callers decide the default. */
export function normalizeCrewCloseMode(value: unknown): CrewCloseMode | null {
  return value === "strict" || value === "parent" || value === "deadline" ? value : null;
}

/** Stored-value view: absent/garbage degrades to today's behavior (strict). */
export function crewCloseModeOf(task: { crewCloseMode?: unknown }): CrewCloseMode {
  return normalizeCrewCloseMode(task.crewCloseMode) ?? "strict";
}

/** Task expiry (one-time tasks only). Null = absent-or-invalid input;
 *  callers decide the default (never). */
export function normalizeExpiresAfterDays(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 30
    ? value
    : null;
}
