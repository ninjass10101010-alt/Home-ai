/**
 * Client-side image downscaling for uploads.
 *
 * The wall tile is ~333px wide (514px tall as a hero), so shipping a phone's
 * 8MB original to a 24/7 panel is wasteful, and asking the PocketBase container
 * to resize means depending on ffmpeg being inside a minimal image. Doing it on
 * the device with a canvas costs nothing, needs no new dependency, and produces
 * bytes we can reason about. The untouched original still goes up alongside it.
 */

/** Long-edge target for the wall copy: 2× the hero tile, with headroom. */
export const WALL_MAX_EDGE = 1600;

export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Decode `file`, scale it so its longest edge is at most `maxEdge` (never
 * upscale), and re-encode as JPEG. Returns null when the browser can't decode
 * it — HEIC from an iPhone, for instance, which Safari on macOS decodes but
 * Chrome on Android may not. The caller keeps the original in that case: a
 * photo we can't resize is still worth archiving, and the widget falls back to
 * serving the original.
 */
export async function resizeForWall(
  file: File | Blob,
  maxEdge: number = WALL_MAX_EDGE,
  quality = 0.82,
): Promise<ResizedImage | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return null;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (!blob || blob.size === 0) return null;
    return { blob, width, height };
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}
