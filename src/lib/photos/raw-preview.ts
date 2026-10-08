/**
 * Extract the embedded JPEG preview from a camera RAW file, in the browser.
 *
 * A RAW (DNG/CR2/NEF/ARW/…) cannot be decoded by `createImageBitmap`, so
 * `resizeForWall` returns null and the wall would have nothing to render. The
 * accepted RAW formats are the TIFF-magic-42 family: they carry at least one
 * full-size JPEG preview, and PocketBase detects them by that magic as
 * `image/tiff`. Slicing that preview out of the container is pure byte parsing
 * — no decoder, no dependency, no server image library — and gives the wall a
 * real picture while the RAW itself stays in the archive.
 *
 * ORF/RW2 are deliberately NOT accepted: their containers are not TIFF-magic
 * 42, PocketBase's content sniff reports them `application/octet-stream`, and
 * the schema rejects that — advertising them would 502 on every upload.
 *
 * This is deliberately tolerant: an unreadable or preview-less file returns
 * `null` and the caller archives the original honestly rather than failing the
 * upload. It never throws.
 *
 * Formats that are not TIFF-based (Canon CR3, Fuji RAF, Sigma X3F, and the
 * ORF/RW2 containers above) have no IFD0/SubIFD preview to find here and take
 * the same honest null path.
 */

export const RAW_EXTENSIONS = [
  "dng",
  "cr2",
  "nef",
  "arw",
  "pef",
  "sr2",
  "srw",
  "rwl",
  "raw",
] as const;

/** True when `name` ends in a recognised TIFF-based RAW extension. */
export function isRawFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return (RAW_EXTENSIONS as readonly string[]).includes(ext);
}

const TAG_SUB_IFDS = 330;
const TAG_COMPRESSION = 259;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_JPEG_OFFSET = 513;
const TAG_JPEG_LENGTH = 514;
const COMPRESSION_JPEG = 7;

const MAX_IFD_ENTRIES = 4096;
const MAX_DEPTH = 8;
const MAX_STRIP_COUNT = 1024;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  value: number;
  valuePos: number;
}

interface ByteReader {
  bytes: Uint8Array;
  view: DataView;
  littleEndian: boolean;
  u16(pos: number): number;
  u32(pos: number): number;
}

function readerFor(bytes: Uint8Array): ByteReader | null {
  if (bytes.byteLength < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let littleEndian: boolean;
  if (bytes[0] === 0x49 && bytes[1] === 0x49) littleEndian = true;
  else if (bytes[0] === 0x4d && bytes[1] === 0x4d) littleEndian = false;
  else return null;
  return {
    bytes,
    view,
    littleEndian,
    u16: (pos) => view.getUint16(pos, littleEndian),
    u32: (pos) => view.getUint32(pos, littleEndian),
  };
}

function readIfd(reader: ByteReader, offset: number): { entries: TiffEntry[]; next: number } | null {
  const { bytes } = reader;
  if (offset < 8 || offset + 2 > bytes.byteLength) return null;
  const count = reader.u16(offset);
  if (count > MAX_IFD_ENTRIES) return null;
  const entriesEnd = offset + 2 + 12 * count;
  if (entriesEnd + 4 > bytes.byteLength) return null;

  const entries: TiffEntry[] = [];
  for (let i = 0; i < count; i++) {
    const pos = offset + 2 + 12 * i;
    const tag = reader.u16(pos);
    const type = reader.u16(pos + 2);
    const entryCount = reader.u32(pos + 4);
    // SHORT values live in the low 2 bytes of the 4-byte value field; every
    // other type we care about (LONG, IFD) is a full 32-bit value.
    const value = type === 3 ? reader.u16(pos + 8) : reader.u32(pos + 8);
    entries.push({ tag, type, count: entryCount, value, valuePos: pos + 8 });
  }
  return { entries, next: reader.u32(entriesEnd) };
}

function findEntry(entries: TiffEntry[], tag: number): TiffEntry | undefined {
  return entries.find((e) => e.tag === tag);
}

/** A tag whose count>1 stores an array of u32 offsets at `entry.value`. */
function readU32Array(reader: ByteReader, entry: TiffEntry): number[] | null {
  const { bytes } = reader;
  const count = entry.count;
  if (count <= 0) return null;
  if (count > MAX_STRIP_COUNT) return null;
  if (count === 1) return [entry.value];
  if (entry.value + 4 * count > bytes.byteLength) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(reader.u32(entry.value + 4 * i));
  return out;
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.byteLength - 2] === 0xff &&
    bytes[bytes.byteLength - 1] === 0xd9
  );
}

function sliceCandidate(reader: ByteReader, offset: number, length: number): Uint8Array | null {
  const end = offset + length;
  if (offset < 0 || length <= 0 || end > reader.bytes.byteLength) return null;
  const slice = reader.bytes.subarray(offset, end);
  return isJpeg(slice) ? slice : null;
}

/** The JPEG preview declared by an IFD (513/514, else JPEG-compressed strips). */
function previewFromIfd(reader: ByteReader, entries: TiffEntry[]): Uint8Array | null {
  const jpegOffset = findEntry(entries, TAG_JPEG_OFFSET);
  const jpegLength = findEntry(entries, TAG_JPEG_LENGTH);
  if (jpegOffset && jpegLength) {
    const slice = sliceCandidate(reader, jpegOffset.value, jpegLength.value);
    if (slice) return slice;
  }

  const compression = findEntry(entries, TAG_COMPRESSION);
  const stripOffsets = findEntry(entries, TAG_STRIP_OFFSETS);
  const stripCounts = findEntry(entries, TAG_STRIP_BYTE_COUNTS);
  if (compression?.value !== COMPRESSION_JPEG || !stripOffsets || !stripCounts) return null;

  const offsets = readU32Array(reader, stripOffsets);
  const counts = readU32Array(reader, stripCounts);
  if (!offsets || !counts || offsets.length === 0) return null;

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < offsets.length; i++) {
    const length = counts[i] ?? counts[counts.length - 1];
    const end = offsets[i] + length;
    if (length <= 0 || end > reader.bytes.byteLength) return null;
    parts.push(reader.bytes.subarray(offsets[i], end));
    total += length;
  }
  if (total > MAX_PREVIEW_BYTES) return null;
  const merged = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return isJpeg(merged) ? merged : null;
}

/** Walk an IFD chain, gathering every JPEG preview it (or its SubIFDs) holds. */
function collectPreviews(reader: ByteReader, firstOffset: number, depth: number, seen: Set<number>, out: Uint8Array[]): void {
  if (depth > MAX_DEPTH) return;
  let offset = firstOffset;
  let guard = 0;
  while (offset >= 8 && !seen.has(offset) && guard++ < MAX_IFD_ENTRIES) {
    seen.add(offset);
    const ifd = readIfd(reader, offset);
    if (!ifd) return;
    const preview = previewFromIfd(reader, ifd.entries);
    if (preview) out.push(preview);
    const subIfds = findEntry(ifd.entries, TAG_SUB_IFDS);
    if (subIfds) {
      const subs = readU32Array(reader, subIfds);
      if (subs) for (const sub of subs) collectPreviews(reader, sub, depth + 1, seen, out);
    }
    offset = ifd.next;
  }
}

export async function extractRawPreview(file: Blob): Promise<Blob | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reader = readerFor(bytes);
    if (!reader || reader.u16(2) !== 42) return null;
    const ifd0 = reader.u32(4);
    const previews: Uint8Array[] = [];
    collectPreviews(reader, ifd0, 0, new Set<number>(), previews);
    if (previews.length === 0) return null;
    let best = previews[0];
    for (const candidate of previews) {
      if (candidate.byteLength > best.byteLength) best = candidate;
    }
    // Copy out of the (possibly large) source buffer so the blob holds only
    // the preview bytes, not a view into the whole RAW file.
    return new Blob([best.slice()], { type: "image/jpeg" });
  } catch {
    return null;
  }
}
