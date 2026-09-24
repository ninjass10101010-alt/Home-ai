// PocketBase tasks.assigneeEmoji is a text field with max=5000 (pb-seed
// default). Real photo avatars live in members.emoji as 100KB+ base64 data
// URLs — copying one raw into a task row fails validation_max_text_constraint
// and the whole task never lands in the collection (so server readers never
// see a pendingApproval from another device). The SNAPSHOT keeps the full
// photo for Avatar rendering; only PB collection writes must sanitize.
export const PB_TASK_EMOJI_MAX = 5000;

const FALLBACK_GLYPH = "👤";

function isAvatarUrl(value: string): boolean {
  return /^(data:|https?:\/\/)/i.test(value);
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
 * persistedTaskEmoji: the SNAPSHOT keeps full fidelity for rendering; only
 * PB collection writes sanitize (rendering is live-roster-first per the
 * kid-board contract, so nothing loses fidelity).
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
