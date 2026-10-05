/**
 * Photo widget settings — the pure layer.
 *
 * One normalizer with three callers (spec §1.1): the `/api/photos/settings`
 * route, the `usePhotoSettings` hook, and the settings form. It is total —
 * `undefined`, `null`, a string, or a hand-edited PocketBase row with a
 * garbage enum all come back as a valid `PhotoSettings`, so a bad row can
 * never crash or blank the wall.
 *
 * Deliberately DOM-free and server-free (no `next/*`, no PocketBase, no
 * `matchMedia`) so it unit-tests in the plain node environment and can be
 * imported from a client component, a route handler, or a test alike.
 */

export type PhotoTransition = "crossfade" | "dissolve" | "slide" | "cut";
export type PhotoOrder = "shuffle" | "newest" | "oldest";

export interface PhotoSettings {
  /** Seconds each photo stays on screen. Clamped to [10, 600]. */
  rotateSeconds: number;
  transition: PhotoTransition;
  order: PhotoOrder;
  showCaption: boolean;
}

export const PHOTO_TRANSITIONS = ["crossfade", "dissolve", "slide", "cut"] as const;
export const PHOTO_ORDERS = ["shuffle", "newest", "oldest"] as const;

export const ROTATE_MIN_S = 10;
export const ROTATE_MAX_S = 600;

export const PHOTO_SETTINGS_DEFAULTS: PhotoSettings = {
  rotateSeconds: 75,
  transition: "crossfade",
  order: "shuffle",
  showCaption: true,
};

/** The two-layer opacity fade's budget — matches `--motion-glide` in
 *  `globals.css` (asserted equal in a test so the two cannot drift). */
export const CROSSFADE_MS = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransition(value: unknown): value is PhotoTransition {
  return typeof value === "string" && (PHOTO_TRANSITIONS as readonly string[]).includes(value);
}

function isOrder(value: unknown): value is PhotoOrder {
  return typeof value === "string" && (PHOTO_ORDERS as readonly string[]).includes(value);
}

/**
 * `rotateSeconds` into `[10, 600]`; anything that is not a finite number
 * (including a numeric *string* — PocketBase hands back numbers, so a string
 * means someone edited the row by hand) falls back to the default 75.
 */
export function clampRotateSeconds(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return PHOTO_SETTINGS_DEFAULTS.rotateSeconds;
  return Math.min(ROTATE_MAX_S, Math.max(ROTATE_MIN_S, n));
}

/**
 * Total normalizer. Every field is independently repaired:
 * `rotateSeconds` clamps, unrecognised enums fall back to their default
 * member (a *read* silently heals; the write path rejects instead — spec §2),
 * and `showCaption` only stays `false` when it literally *is* `false`.
 */
export function normalizePhotoSettings(raw: unknown): PhotoSettings {
  const row = isRecord(raw) ? raw : {};
  return {
    rotateSeconds: clampRotateSeconds(row.rotateSeconds),
    transition: isTransition(row.transition)
      ? row.transition
      : PHOTO_SETTINGS_DEFAULTS.transition,
    order: isOrder(row.order) ? row.order : PHOTO_SETTINGS_DEFAULTS.order,
    showCaption:
      typeof row.showCaption === "boolean"
        ? row.showCaption
        : PHOTO_SETTINGS_DEFAULTS.showCaption,
  };
}

/**
 * Plain-unit readout for the settings slider: `45s`, `2m 30s`, `5m`.
 * Fractions are floored — a half-second of rotation is not a thing the
 * family can perceive, and `1m 30.4s` is noise.
 */
export function formatRotateLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * How long to wait after the outgoing photo is armed before swapping layers
 * (spec §3.4). Pure and DOM-free.
 *
 * - reduced motion → `0` for every transition (deliberate change from the old
 *   60 ms; the helper is only consulted after the arm `requestAnimationFrame`,
 *   so the frame has already been scheduled).
 * - `cut` → `0`.
 * - `dissolve` → `300` (swap at the veil's peak; the fade-out continues after).
 * - `crossfade` / `slide` → `CROSSFADE_MS + 120` (today's value, unchanged).
 */
export function commitDelayMs(transition: PhotoTransition, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  if (transition === "cut") return 0;
  if (transition === "dissolve") return 300;
  return CROSSFADE_MS + 120;
}
