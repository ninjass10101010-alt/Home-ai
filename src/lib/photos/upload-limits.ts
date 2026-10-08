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

import { isRawFileName } from "./raw-preview";

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

/**
 * RAW camera formats accepted on the ORIGINAL field only.
 *
 * The wall field stays JPEG/WebP (it is a browser-rendered derivative), but the
 * archive can hold a RAW original. PocketBase detects a RAW by content magic —
 * every common RAW is TIFF-based, so `mimetype` reports `image/tiff` regardless
 * of extension — which is why `image/tiff` must be here even though the client
 * usually declares `image/x-adobe-dng` or nothing at all.
 */
export const RAW_IMAGE_TYPES = [
  "image/x-adobe-dng",
  "image/dng",
  "image/tiff",
  "image/x-canon-cr2",
  "image/x-nikon-nef",
  "image/x-sony-arw",
] as const;

/** Every MIME type accepted on the original field (base images + RAW aliases). */
export const ALLOWED_ORIGINAL_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...RAW_IMAGE_TYPES,
] as const;

/** Type guard for the original-field allowlist. */
export function isAllowedOriginalType(type: string): boolean {
  return (ALLOWED_ORIGINAL_TYPES as readonly string[]).includes(type);
}

/**
 * Is this file acceptable as an `original`? Browsers are unreliable about a
 * RAW's declared MIME type (often `""`), so the extension is the fallback that
 * actually makes a `.dng` uploadable.
 */
export function isAllowedOriginalFile(file: Pick<File, "type" | "name">): boolean {
  return isAllowedOriginalType(file.type) || isRawFileName(file.name);
}
