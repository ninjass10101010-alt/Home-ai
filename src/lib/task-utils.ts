import { db } from "@/db";
import { localTodayISO } from "@/lib/local-date";
import type { Task, WeekData, Transaction, WeekArchive, FamilyGoal, HallOfFameEntry, Reward, Penalty } from "@/types/tasks";

export const TASKS_STORAGE_KEY = "consuela-tasks";
export const WEEK_DATA_KEY = "consuela-week-data";
export const ARCHIVE_KEY = "consuela-week-archive";
export const REWARDS_KEY = "consuela-rewards";
export const PENALTIES_KEY = "consuela-penalties";
export const REGEN_TRACKER_KEY = "consuela-regen-week";
export const FAMILY_GOAL_KEY = "consuela-family-goal";
export const HALL_OF_FAME_KEY = "consuela-hall-of-fame";

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function todayMondayISO(): string {
  return mondayOf(new Date()).toISOString().split("T")[0];
}

export function weekKey(date?: Date): string {
  return mondayOf(date || new Date()).toISOString().split("T")[0];
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
  return pendingApprovals(tasks)
    .filter((t) => t.pendingApproval!.byName === memberName)
    .reduce((sum, t) => sum + (t.pendingApproval!.points || 0), 0);
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
  // Idempotency: another device already paid this tap — clear without
  // re-paying. A REVERSED earn (an undo) released the task though, so a
  // re-tap must be payable again — the same distinction the server claim
  // route makes. Reversal-blindness here silently swallowed the second
  // approval ("Approved! +5pts" toast, zero points moved).
  const earns = weekData.history.filter(
    (tx) => tx.type === "earn" && tx.taskId === taskId
  );
  const latestEarn = earns[earns.length - 1];
  if (latestEarn) {
    const reversed = weekData.history.some(
      (tx) =>
        tx.taskId === taskId &&
        tx.type === "adjust" &&
        tx.amount < 0 &&
        tx.timestamp >= latestEarn.timestamp
    );
    if (!reversed) return { tasks: cleared, weekData };
  }
  const owner = task.pendingApproval!.byName;
  const sameWeek = task.completedInWeek === weekData.weekStart;
  const pointsMsg = task.points > 0 ? ` (+${task.points}pts)` : "";
  const withPoints = {
    ...weekData,
    points: { ...weekData.points, [owner]: (weekData.points[owner] || 0) + task.points },
  };
  const next = addTransaction(
    withPoints,
    "earn",
    task.points,
    `${sameWeek ? "Completed" : "Approved"}: ${task.title}${pointsMsg}`,
    owner,
    task.id
  );
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
      ? { ...t, completed: false, completedBy: undefined, completedAt: undefined, completedInWeek: undefined, pendingApproval: undefined, sentBackAt: new Date().toISOString() }
      : t
  );
}

export function emptyWeekData(startISO?: string): WeekData {
  return {
    weekStart: startISO || todayMondayISO(),
    points: {},
    streak: {},
    lastActive: {},
    history: [],
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

function saveJSON(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* quota exceeded — non-critical */
  }
}

export function loadWeekData(): WeekData {
  const stored = loadJSON<WeekData | null>(WEEK_DATA_KEY, null);
  if (!stored || !stored.weekStart) return emptyWeekData();
  const currentMonday = todayMondayISO();
  if (stored.weekStart !== currentMonday) {
    archiveAndResetWeek(stored, currentMonday);
    return emptyWeekData(currentMonday);
  }
  return stored;
}

export function saveWeekData(data: WeekData): void {
  saveJSON(WEEK_DATA_KEY, data);
}

export function archiveAndResetWeek(oldWeek: WeekData, newMonday: string): void {
  const archive = loadJSON<WeekArchive>(ARCHIVE_KEY, {});
  archive[oldWeek.weekStart] = oldWeek;
  const keys = Object.keys(archive).sort();
  if (keys.length > 12) {
    for (let i = 0; i < keys.length - 12; i++) {
      delete archive[keys[i]];
    }
  }
  saveJSON(ARCHIVE_KEY, archive);
  saveJSON(WEEK_DATA_KEY, emptyWeekData(newMonday));
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
  allCompletionsThisWeek: string[]
): number {
  const today = todayISO();
  const monday = mondayOf(new Date(today));

  let streak = 0;
  const check = new Date(today);

  while (check >= monday) {
    const checkISO = check.toISOString().split("T")[0];
    const hasCompletion = allCompletionsThisWeek.some(
      (d) => d.split("T")[0] === checkISO
    );
    if (!hasCompletion) break;
    streak++;
    check.setDate(check.getDate() - 1);
  }

  return streak;
}

export function regenerateRecurringTasks(tasks: Task[]): Task[] {
  const now = todayISO();
  const monday = todayMondayISO();

  const regenKey = loadJSON<string | null>(REGEN_TRACKER_KEY, null);
  if (regenKey === monday) return tasks;
  saveJSON(REGEN_TRACKER_KEY, monday);

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
      // Universal recurring tasks come back unclaimed — no ghost assignee from last week
      assignee: t.universal ? "All" : t.assignee,
      assigneeEmoji: t.universal ? "🤝" : t.assigneeEmoji,
      due: now,
    };
  });

  return [...remaining, ...clones];
}

export function getThisWeeksCompletedDates(tasks: Task[], memberName?: string): string[] {
  const monday = todayMondayISO();
  const now = todayISO();
  return tasks
    .filter(
      (t) =>
        t.completed &&
        t.completedAt &&
        (!memberName || t.completedBy === memberName)
    )
    .map((t) => t.completedAt!)
    // completedAt values are full ISO timestamps — compare date parts only,
    // otherwise today's completions never satisfy `d <= now` (date-only).
    .filter((d) => d.slice(0, 10) >= monday && d.slice(0, 10) <= now);
}

export function getThisWeeksCompletedTasks(tasks: Task[]): Task[] {
  const monday = todayMondayISO();
  const now = todayISO();
  return tasks.filter(
    (t) => t.completed && (
      t.completedInWeek === monday ||
      (!t.completedInWeek && t.completedAt && t.completedAt >= monday && t.completedAt <= now)
    )
  );
}

export function loadTasks(): Task[] {
  const raw = loadJSON<Task[]>(TASKS_STORAGE_KEY, []);
  return regenerateRecurringTasks(raw);
}

export function saveTasks(tasks: Task[]): void {
  saveJSON(TASKS_STORAGE_KEY, tasks);
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
): { tasks: Task[]; weekData: WeekData; tasksChanged: boolean; weekChanged: boolean } {
  let tasks = currentTasks;
  let weekData = currentWeekData;
  let tasksChanged = false;
  let weekChanged = false;
  if (!snapshot) return { tasks, weekData, tasksChanged, weekChanged };

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
    }));
    const fresh = restored.filter(
      (t: any) => !currentTasks.some((p: any) => p.id === t.id || p.title === t.title)
    );
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
    if (!pendingDiffers && !completionDiffers) continue;
    const localDone = !!local.completed || !!localPending;
    const remoteClearsPending = !!localPending && !snapshotPending;
    const remoteReopens = !!local.completed && !snapRow.completed;
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
    if (currentWeekData.weekStart !== snapWk.weekStart) {
      // A different week is adopted ONLY when the snapshot is at least as new
      // as the local one (ISO dates compare lexically). A snapshot week OLDER
      // than the local week is stale — no device has synced since the Monday
      // rollover — and adopting it resurrects last week's points into the
      // fresh week (which the week-reset interval then archives and wipes).
      if (String(snapWk.weekStart) >= String(currentWeekData.weekStart)) {
        weekData = { ...currentWeekData, ...snapWk };
        weekChanged = true;
      }
    } else if ((snapWk.history?.length || 0) > (currentWeekData.history?.length || 0)) {
      // Same week, but another device recorded more transactions — adopt the
      // richer weekData so cross-device points aren't lost.
      weekData = { ...currentWeekData, ...snapWk };
      weekChanged = true;
    }
  }

  return { tasks, weekData, tasksChanged, weekChanged };
}

/**
 * Store-level seam for the 60s refresh loop (db.refreshCaches): the caller
 * reads /api/tasks/sync and hands the snapshot here, which merges it into the
 * same localStorage stores loadTasks()/loadWeekData() read — so KidHome's
 * dataVersion listener and Home's widgets actually see another device's
 * tasks when they re-read on `consuela-data-refreshed`. Returns whether
 * anything changed.
 */
export function applyTasksSnapshotToStores(snapshot: any): boolean {
  if (!snapshot) return false;
  const { tasks, weekData, tasksChanged, weekChanged } = mergeTasksSnapshot(
    loadTasks(),
    loadWeekData(),
    snapshot
  );
  if (tasksChanged) saveTasks(tasks);
  if (weekChanged) saveWeekData(weekData);
  return tasksChanged || weekChanged;
}

export function loadRewards<T>(fallback: T): T {
  return loadJSON(REWARDS_KEY, fallback);
}

export function saveRewards<T>(rewards: T): void {
  saveJSON(REWARDS_KEY, rewards);
}

export function loadPenalties<T>(fallback: T): T {
  return loadJSON(PENALTIES_KEY, fallback);
}

export function savePenalties<T>(penalties: T): void {
  saveJSON(PENALTIES_KEY, penalties);
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
  const now = new Date();
  const nextMonday = mondayOf(new Date(now.getTime() + 7 * 86400000));
  const diffMs = nextMonday.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

export function getPreviousWeekRanks(): Record<string, number> {
  return loadJSON<Record<string, number>>(PREV_RANKS_KEY, {});
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
  const today = todayISO();
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

export function archiveWeekWinner(entries: { name: string; emoji: string; points: number; rank: number }[], weekStart: string): void {
  if (entries.length === 0) return;
  const hall = loadHallOfFame();
  const winner = entries[0];
  hall.push({
    member: winner.name,
    emoji: winner.emoji,
    weekStart,
    points: winner.points,
    rank: winner.rank,
  });
  const trimmed = hall.slice(-12);
  saveHallOfFame(trimmed);
}

// === PocketBase sync helpers ===

export async function syncTasksToPB(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    await db.upsertTask({
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      assigneeEmoji: task.assigneeEmoji,
      // Home widget's selectPendingTasks reads `assigned` + `status` —
      // without these the row is invisible to the pending-tasks reader.
      assigned: task.assignee,
      status: task.completed ? "done" : "pending",
      due: task.due,
      points: task.points,
      recurring: task.recurring,
      category: task.category,
      priority: task.priority,
      universal: task.universal || false,
      stealable: task.stealable || false,
      pendingApproval: task.pendingApproval ?? null,
      sentBackAt: task.sentBackAt ?? null,
      completedInWeek: task.completedInWeek ?? null,
      completedAt: task.completedAt ?? null,
    }).catch(() => {});
  }
}

export async function syncWeekDataToPB(data: WeekData): Promise<void> {
  await db.upsertWeekData(data).catch(() => {});
}

export async function syncArchiveToPB(archive: WeekArchive): Promise<void> {
  for (const [weekStart, weekData] of Object.entries(archive)) {
    await db.upsertWeekData({
      ...weekData,
      weekStart,
      archivedAt: new Date().toISOString(),
    }).catch(() => {});
  }
}

export async function syncRewardsToPB(rewards: Reward[]): Promise<void> {
  for (const r of rewards) {
    await db.upsertReward({
      name: r.name,
      emoji: r.emoji,
      cost: r.cost,
    }).catch(() => {});
  }
}

export async function syncPenaltiesToPB(penalties: Penalty[]): Promise<void> {
  for (const p of penalties) {
    await db.upsertPenalty({
      name: p.name,
      emoji: p.emoji,
      points: p.points,
    }).catch(() => {});
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

export async function syncHallOfFameToPB(entries: HallOfFameEntry[]): Promise<void> {
  // Idempotent sync: skip entries whose member + weekStart already exist in
  // PB (insertHallOfFameEntry always creates — re-inserting would duplicate).
  const existing = await db.selectHallOfFame().catch(() => [] as any[]);
  for (const e of entries) {
    const alreadySynced = existing.some(
      (row: any) => row.member === e.member && row.weekStart === e.weekStart
    );
    if (alreadySynced) continue;
    await db.insertHallOfFameEntry({
      member: e.member,
      emoji: e.emoji,
      weekStart: e.weekStart,
      points: e.points,
      rank: e.rank,
    }).catch(() => {});
  }
}

export async function syncAllTasksToPB(
  tasks: Task[],
  weekData: WeekData,
  archive: WeekArchive,
  rewards: Reward[],
  penalties: Penalty[],
  hallOfFame: HallOfFameEntry[]
): Promise<void> {
  await Promise.allSettled([
    syncTasksToPB(tasks),
    syncWeekDataToPB(weekData),
    syncArchiveToPB(archive),
    syncRewardsToPB(rewards),
    syncPenaltiesToPB(penalties),
    syncHallOfFameToPB(hallOfFame),
  ]);
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
