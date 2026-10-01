/**
 * Photos Feature — the wall's living family photo stream.
 *
 * Design notes (why this shape):
 *
 *  - TWO file fields, not one. `original` is the untouched upload (the family
 *    archive); `wall` is a ~1600px JPEG produced on-device at upload time and is
 *    the only file the panel ever requests. Resizing client-side means the wall
 *    never asks a phone-sized 8MB HEIC to fit a 333px tile, and the container
 *    needs no image library or ffmpeg.
 *  - NO relation fields. A relation to a collection whose real name differs
 *    from the one declared here would fail at CREATE time against the live
 *    database, so provenance is stored as plain text instead.
 *  - `showOnWall` is the pull-one-photo-off lever: a single false in the
 *    PocketBase admin UI removes a picture from every screen at once, with no
 *    redeploy.
 */

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface PhotoRecord {
  id: string;
  /** Filename in the `original` file field (archive copy). */
  original: string;
  /** Filename in the `wall` file field; empty when no resized copy was made. */
  wall: string;
  takenAt: string;
  caption?: string;
  album?: string;
  showOnWall: boolean;
  uploadedBy?: string;
  width?: number;
  height?: number;
  created: string;
}

/** What the widget consumes: a wall-ready photo plus a same-origin URL. */
export interface WallPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  takenAt: string;
  caption?: string;
  album?: string;
  /** Only present on the Photos page (`all=1`); the wall feed implies true. */
  showOnWall?: boolean;
}

// ─── Schema Declaration ──────────────────────────────────────────────────────

export const photosSchema = {
  name: 'photos',
  type: 'base',
  fields: [
    { name: 'original', type: 'file', required: true, maxSize: 20971520, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] },
    { name: 'wall', type: 'file', required: false, maxSize: 8388608, mimeTypes: ['image/jpeg', 'image/webp'] },
    { name: 'takenAt', type: 'date', required: false },
    { name: 'caption', type: 'text', required: false },
    { name: 'album', type: 'text', required: false },
    { name: 'showOnWall', type: 'bool', required: false, defaultValue: true },
    { name: 'uploadedBy', type: 'text', required: false },
    { name: 'width', type: 'number', required: false },
    { name: 'height', type: 'number', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_photos_show_on_wall ON photos (showOnWall)',
    'CREATE INDEX idx_photos_taken_at ON photos (takenAt)',
  ],
};

// ─── Utility Functions ───────────────────────────────────────────────────────

/** PocketBase record ids are 15 lowercase alphanumerics. Routes validate the
 *  id out of the query string before touching the collection with it. */
export const PB_RECORD_ID = /^[a-z0-9]{15}$/;

/**
 * True when a photo was first taken on this calendar day in a previous year —
 * the "on this day" moment that makes a rotating wall feel alive rather than
 * random. Deliberately strict about the year so today's photo never qualifies.
 */
export function isOnThisDay(takenAt: string, now: Date = new Date()): boolean {
  const taken = new Date(takenAt);
  if (Number.isNaN(taken.getTime())) return false;
  if (taken.getFullYear() >= now.getFullYear()) return false;
  return taken.getMonth() === now.getMonth() && taken.getDate() === now.getDate();
}
