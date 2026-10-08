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
    // `original` accepts RAW too: every common RAW is TIFF-based, so PocketBase
    // detects it as `image/tiff` by content magic. Keep this list in parity
    // with `ALLOWED_ORIGINAL_TYPES` (tests/unit/photos-upload.test.ts pins it).
    { name: 'original', type: 'file', required: true, maxSize: 104857600, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/x-adobe-dng', 'image/dng', 'image/tiff', 'image/x-canon-cr2', 'image/x-nikon-nef', 'image/x-sony-arw'] },
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

/**
 * The wall's behavioural settings — ONE row, `key = "wall"` (spec §1).
 *
 * Server-side rather than localStorage because the widget runs on the wall,
 * which is its own device: a setting stored on a phone would never reach it.
 * There are deliberately no per-member rows — the wall is family-shared, and a
 * per-row-per-parent design would let two parents fight over one panel.
 *
 * Access rules are `null` on every field (set by `createCollection`, like every
 * other feature collection): the browser never talks to PocketBase, only the
 * `/api/photos/settings` route does.
 *
 * `maxSelect: 1` is explicit on both selects on purpose — `buildPBField`
 * defaults an unset `maxSelect` to `null`, which PocketBase reads as
 * "allow multiple" and would silently turn a single-choice control into an
 * array.
 */
export const photoSettingsSchema = {
  name: 'photo_settings',
  type: 'base',
  fields: [
    { name: 'key', type: 'text', required: true, defaultValue: 'wall' },
    { name: 'rotateSeconds', type: 'number', required: false, defaultValue: 75 },
    { name: 'transition', type: 'select', required: false, values: ['crossfade', 'dissolve', 'slide', 'cut'], defaultValue: 'crossfade', maxSelect: 1 },
    { name: 'order', type: 'select', required: false, values: ['shuffle', 'newest', 'oldest'], defaultValue: 'shuffle', maxSelect: 1 },
    { name: 'showCaption', type: 'bool', required: false, defaultValue: true },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_photo_settings_key ON photo_settings (key)',
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
