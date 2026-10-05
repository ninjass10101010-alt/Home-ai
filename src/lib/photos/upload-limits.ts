/**
 * Upload ceilings + the accepted image types — ONE source for the API route,
 * the client uploader, and (by parity test) the PocketBase schema.
 *
 * Client-safe on purpose: no server-only imports, so `PhotoUploader.tsx` and
 * `api/photos/upload` both read the same numbers. Before this module the same
 * ceiling existed as four copies of a literal (route, uploader constant,
 * uploader error string, schema) — `tests/unit/photos-upload.test.ts` pins the
 * remaining schema literal to these values, so the next bump is still two
 * edits but they can no longer disagree silently.
 */

/** Archive copy, kept exactly as uploaded: 100 MB (spec §6; was 20 MB). */
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;

/** The client-resized ~1600px JPEG for the panel. ~300 KB in practice, so
 *  8 MB is already ~25× headroom and did not need to move (spec §6). */
export const MAX_WALL_BYTES = 8 * 1024 * 1024;

/** Everything accepted on either file field — the route's allowlist, shared so
 *  the client rejects the same set instead of a looser `image/*` prefix. */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Type guard for the allowlist above. */
export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}
