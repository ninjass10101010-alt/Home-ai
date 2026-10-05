// PocketBase tasks.assigneeEmoji is a text field with max=5000 (pb-seed
// default). Real photo avatars live in members.emoji as 100KB+ base64 data
// URLs — copying one raw into a task row fails validation_max_text_constraint
// and the whole task never lands in the collection (so server readers never
// see a pendingApproval from another device).
//
// The SNAPSHOT no longer keeps the full photo either (2026-10-05 incident):
// every member-assigned add copied the raw 105-246KB photo into the snapshot
// row's tasks[].assigneeEmoji until the single `tasks-snapshot` blob tripped
// PocketBase's json `maxSize` (validation_json_size_limit) and EVERY
// member-assigned add started failing with snapshot_write_failed. Rendering
// is roster-first (src/app/tasks/page.tsx builds assigneeEmojis from
// members.emoji), so the stored value is only the fallback for non-member
// assignees — storing the photo lost nothing a user can see. Snapshot writes
// are now slimmed with TASK_SNAPSHOT_EMOJI_MAX (slimTaskEmoji/slimTaskEmojis,
// and slim-on-read in snapshot-tasks) while PB collection writes keep the
// stricter persisted* sanitizers below.
export const PB_TASK_EMOJI_MAX = 5000;

/**
 * Ceiling for any emoji value persisted into the tasks SNAPSHOT. One real
 * photo data URL is 25-60x this; canonicalEmoji (task-manage) and every claim
 * build site fall back to 👤 above it. Keep in lockstep with
 * TASK_MANAGE_MAX_EMOJI_LENGTH (pinned by tests/unit/snapshot-size-cap-guards.test.ts).
 */
export const TASK_SNAPSHOT_EMOJI_MAX = 4_096;

const FALLBACK_GLYPH = "👤";

function isAvatarUrl(value: string): boolean {
  return /^(data:|https?:\/\/)/i.test(value);
}

/** Slim ONE emoji value for a snapshot row: 👤 above the ceiling, else unchanged. */
export function slimTaskEmoji(emoji?: string | null): string {
  if (!emoji) return "";
  if (emoji.length > TASK_SNAPSHOT_EMOJI_MAX) return FALLBACK_GLYPH;
  return emoji;
}

function slimCrew(crew: unknown): unknown {
  if (!crew || typeof crew !== "object" || Array.isArray(crew)) return crew;
  const raw = crew as { members?: readonly unknown[] | null; [k: string]: unknown };
  if (!Array.isArray(raw.members)) return crew;
  let changed = false;
  const members = raw.members.map((member) => {
    if (!member || typeof member !== "object" || Array.isArray(member)) return member;
    const entry = member as { emoji?: unknown; [k: string]: unknown };
    if (typeof entry.emoji !== "string") return member;
    const emoji = slimTaskEmoji(entry.emoji);
    if (emoji === entry.emoji) return member;
    changed = true;
    return { ...entry, emoji };
  });
  return changed ? { ...raw, members } : crew;
}

/**
 * Idempotent snapshot heal: rewrite any fat assigneeEmoji / crew[].emoji to
 * the 👤 fallback. PURE — returns the input BY REFERENCE when nothing is fat
 * (the mergeTasksSnapshot no-change contract), so a settled slim never
 * produces a perpetual snapshot change.
 */
export function slimTaskEmojis<T extends Record<string, any>>(task: T): T {
  const assignee =
    typeof task.assigneeEmoji === "string" ? slimTaskEmoji(task.assigneeEmoji) : task.assigneeEmoji;
  const crew = slimCrew(task.crew);
  const assigneeChanged = assignee !== task.assigneeEmoji;
  const crewChanged = crew !== task.crew;
  if (!assigneeChanged && !crewChanged) return task;
  return {
    ...task,
    ...(assigneeChanged ? { assigneeEmoji: assignee } : {}),
    ...(crewChanged ? { crew } : {}),
  } as T;
}

/** Sanitize an emoji for PB `tasks.assigneeEmoji` writes (never for display). */
export function persistedTaskEmoji(emoji?: string | null): string {
  if (!emoji) return "";
  if (isAvatarUrl(emoji)) return FALLBACK_GLYPH;
  if (emoji.length > PB_TASK_EMOJI_MAX) return FALLBACK_GLYPH;
  return emoji;
}

/**
 * Sanitize a task's `crew` object for PB `tasks.crew` writes. Crew members'
 * emojis come from members.emoji — a photo avatar there is a 100KB+ base64
 * data URL, and several photo members in one crew push the row toward the
 * PB json field ceiling (and a rejection 500s the join). Same contract as
 * persistedTaskEmoji; snapshot rows are slimmed separately by slimTaskEmoji /
 * slimTaskEmojis (rendering is live-roster-first per the kid-board contract,
 * so nothing loses fidelity).
 */
export function persistedCrewEmoji<
  T extends { emoji?: string | null }
>(crew: { members?: readonly T[] | null; [k: string]: unknown } | null | undefined): {
  members: T[];
  [k: string]: unknown;
} | null {
  if (!crew || typeof crew !== "object") return null;
  const members = Array.isArray(crew.members)
    ? crew.members.map((m) => ({ ...m, emoji: persistedTaskEmoji(m?.emoji) }))
    : [];
  return { ...crew, members };
}
