import { db } from "@/db";
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
    (t) => t.completed && t.recurring && t.completedInWeek !== monday
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
