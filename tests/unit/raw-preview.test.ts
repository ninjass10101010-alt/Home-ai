// src/lib/photos/raw-preview.ts — the embedded-JPEG extractor that lets a RAW
// original (DNG, CR2, NEF, ARW, …) put a real picture on the wall.
//
// Fixtures are hand-built TIFF byte layouts (no camera files, no network): the
// extractor is pure byte parsing, so a fixture IS the format. Little-endian
// (II) and big-endian (MM) headers, an IFD0 preview, a SubIFD preview, a
// JPEG-compressed strip set, and the failure shapes (no preview, non-TIFF,
// truncated offsets) are each pinned here.
import { describe, it, expect } from "vitest";
import { extractRawPreview, isRawFileName, RAW_EXTENSIONS } from "@/lib/photos/raw-preview";

// ─── tiny TIFF byte builders ────────────────────────────────────────────────
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SHORT = 3;
const LONG = 4;

const entryLE = (tag: number, type: number, count: number, value: number) => [
  ...le16(tag), ...le16(type), ...le32(count), ...le32(value),
];
const entryBE = (tag: number, type: number, count: number, value: number) => [
  ...be16(tag), ...be16(type), ...be32(count), ...be32(value),
];

/** A minimal JPEG that starts with SOI+APP0 and ends with EOI. */
function makeJpeg(payload: number): Uint8Array {
  const out = new Uint8Array(payload + 4);
  out[0] = 0xff; out[1] = 0xd8; out[2] = 0xff; out[3] = 0xe0;
  for (let i = 4; i < out.length - 2; i++) out[i] = 0x22;
  out[out.length - 2] = 0xff; out[out.length - 1] = 0xd9;
  return out;
}

/** TIFF with the preview referenced directly from IFD0 (513/514). */
function tiffIfd0Preview(jpeg: Uint8Array): Uint8Array {
  const n = 2;
  const ifdOffset = 8;
  const dataOffset = ifdOffset + 2 + 12 * n + 4;
  return new Uint8Array([
    ...ascii("II"), ...le16(42), ...le32(ifdOffset),
    ...le16(n),
    ...entryLE(513, LONG, 1, dataOffset),
    ...entryLE(514, LONG, 1, jpeg.length),
    ...le32(0),
    ...jpeg,
  ]);
}

/** TIFF whose preview lives in a SubIFD (tag 330). */
function tiffSubIfdPreview(jpeg: Uint8Array): Uint8Array {
  const ifd0Offset = 8;
  const subOffset = ifd0Offset + 2 + 12 * 1 + 4;
  const dataOffset = subOffset + 2 + 12 * 2 + 4;
  return new Uint8Array([
    ...ascii("II"), ...le16(42), ...le32(ifd0Offset),
    ...le16(1),
    ...entryLE(330, LONG, 1, subOffset),
    ...le32(0),
    ...le16(2),
    ...entryLE(513, LONG, 1, dataOffset),
    ...entryLE(514, LONG, 1, jpeg.length),
    ...le32(0),
    ...jpeg,
  ]);
}

/** TIFF with a JPEG-compressed strip (273/279 + Compression=7). */
function tiffStripJpeg(jpeg: Uint8Array): Uint8Array {
  const n = 3;
  const ifdOffset = 8;
  const dataOffset = ifdOffset + 2 + 12 * n + 4;
  return new Uint8Array([
    ...ascii("II"), ...le16(42), ...le32(ifdOffset),
    ...le16(n),
    ...entryLE(259, SHORT, 1, 7),
    ...entryLE(273, LONG, 1, dataOffset),
    ...entryLE(279, LONG, 1, jpeg.length),
    ...le32(0),
    ...jpeg,
  ]);
}

/**
 * TIFF with Compression=7 whose StripOffsets table holds one u32 per entry in
 * `offsets` (StripOffsets count = offsets.length) and a single StripByteCounts
 * value shared by every strip. Offsets are relative to the payload region at
 * the end of the file, so overlapping strips can declare a huge total over a
 * tiny fixture.
 */
function tiffStripTable(jpeg: Uint8Array, stripLength: number, offsets: number[]): Uint8Array {
  const n = 3;
  const ifdOffset = 8;
  const tableOffset = ifdOffset + 2 + 12 * n + 4; // 3 entries: 259, 273, 279
  const regionOffset = tableOffset + 4 * offsets.length;
  const out = new Uint8Array(regionOffset + jpeg.length);
  let at = 0;
  const put = (...vals: number[]) => {
    for (const v of vals) out[at++] = v;
  };
  put(...ascii("II"), ...le16(42), ...le32(ifdOffset));
  put(...le16(n));
  put(...entryLE(259, SHORT, 1, 7));
  put(...entryLE(273, LONG, offsets.length, tableOffset));
  put(...entryLE(279, LONG, 1, stripLength));
  put(...le32(0));
  for (const offset of offsets) put(...le32(regionOffset + offset));
  out.set(jpeg, regionOffset);
  return out;
}

/** IFD0 carries a small preview; a SubIFD carries a larger one. */
function tiffSmallThenLarge(small: Uint8Array, large: Uint8Array): Uint8Array {
  const ifd0Offset = 8;
  const subOffset = ifd0Offset + 2 + 12 * 3 + 4; // 3 entries: 513,514,330
  const smallOffset = subOffset + 2 + 12 * 2 + 4;
  const largeOffset = smallOffset + small.length;
  return new Uint8Array([
    ...ascii("II"), ...le16(42), ...le32(ifd0Offset),
    ...le16(3),
    ...entryLE(513, LONG, 1, smallOffset),
    ...entryLE(514, LONG, 1, small.length),
    ...entryLE(330, LONG, 1, subOffset),
    ...le32(0),
    ...le16(2),
    ...entryLE(513, LONG, 1, largeOffset),
    ...entryLE(514, LONG, 1, large.length),
    ...le32(0),
    ...small,
    ...large,
  ]);
}

/** Big-endian (MM) TIFF with an IFD0 preview. */
function tiffBigEndianPreview(jpeg: Uint8Array): Uint8Array {
  const n = 2;
  const ifdOffset = 8;
  const dataOffset = ifdOffset + 2 + 12 * n + 4;
  return new Uint8Array([
    ...ascii("MM"), ...be16(42), ...be32(ifdOffset),
    ...be16(n),
    ...entryBE(513, LONG, 1, dataOffset),
    ...entryBE(514, LONG, 1, jpeg.length),
    ...be32(0),
    ...jpeg,
  ]);
}

function fileOf(bytes: Uint8Array, name = "IMG_0001.dng"): File {
  // Copy into a fresh ArrayBuffer-backed view so the File constructor's
  // `ArrayBufferView<ArrayBuffer>` overload accepts it.
  return new File([new Uint8Array(bytes)], name, { type: "" });
}

async function bytesOf(blob: Blob | null): Promise<number[] | null> {
  return blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
}

// ─── tests ──────────────────────────────────────────────────────────────────
describe("isRawFileName / RAW_EXTENSIONS", () => {
  it("recognises common TIFF-based RAW extensions, case-insensitively", () => {
    for (const name of ["IMG_1234.DNG", "shot.cr2", "a.nef", "b.ARW", "e.pef", "f.raw"]) {
      expect(isRawFileName(name)).toBe(true);
    }
  });

  it("does not accept ORF or RW2 — non-TIFF magic that PocketBase reports as octet-stream", () => {
    expect(isRawFileName("photo.orf")).toBe(false);
    expect(isRawFileName("photo.rw2")).toBe(false);
  });

  it("does not treat ordinary images or extensionless names as RAW", () => {
    for (const name of ["pic.jpg", "pic.jpeg", "pic.png", "pic.heic", "noext", "archive.dng.txt"]) {
      expect(isRawFileName(name)).toBe(false);
    }
  });

  it("exposes the extension list without duplicates", () => {
    expect(new Set(RAW_EXTENSIONS).size).toBe(RAW_EXTENSIONS.length);
    expect(RAW_EXTENSIONS).toContain("dng");
  });
});

describe("extractRawPreview — the embedded JPEG", () => {
  it("returns the IFD0 513/514 preview as an image/jpeg blob", async () => {
    const jpeg = makeJpeg(64);
    const blob = await extractRawPreview(fileOf(tiffIfd0Preview(jpeg)));
    expect(blob?.type).toBe("image/jpeg");
    expect(await bytesOf(blob)).toEqual([...jpeg]);
  });

  it("finds a preview inside a SubIFD", async () => {
    const jpeg = makeJpeg(40);
    const blob = await extractRawPreview(fileOf(tiffSubIfdPreview(jpeg)));
    expect(await bytesOf(blob)).toEqual([...jpeg]);
  });

  it("concatenates a JPEG-compressed strip set (Compression=7)", async () => {
    const jpeg = makeJpeg(32);
    const blob = await extractRawPreview(fileOf(tiffStripJpeg(jpeg)));
    expect(await bytesOf(blob)).toEqual([...jpeg]);
  });

  it("picks the LARGEST available preview", async () => {
    const small = makeJpeg(16);
    const large = makeJpeg(256);
    const blob = await extractRawPreview(fileOf(tiffSmallThenLarge(small, large)));
    expect(await bytesOf(blob)).toEqual([...large]);
  });

  it("reads a big-endian (MM) TIFF", async () => {
    const jpeg = makeJpeg(48);
    const blob = await extractRawPreview(fileOf(tiffBigEndianPreview(jpeg)));
    expect(await bytesOf(blob)).toEqual([...jpeg]);
  });
});

describe("extractRawPreview — honest nulls, never a throw", () => {
  it("returns null for a TIFF with no preview", async () => {
    const bytes = new Uint8Array([
      ...ascii("II"), ...le16(42), ...le32(8),
      ...le16(1), ...entryLE(256, LONG, 1, 100), ...le32(0),
    ]);
    expect(await extractRawPreview(fileOf(bytes))).toBeNull();
  });

  it("returns null for a non-TIFF file", async () => {
    const jpeg = makeJpeg(64); // a bare JPEG is not a RAW container
    expect(await extractRawPreview(fileOf(new Uint8Array(jpeg)))).toBeNull();
  });

  it("returns null (no throw) when the IFD offset is past the end", async () => {
    const bytes = new Uint8Array([...ascii("II"), ...le16(42), ...le32(0xfffffff0)]);
    expect(await extractRawPreview(fileOf(bytes))).toBeNull();
  });

  it("returns null (no throw) when a preview offset points outside the file", async () => {
    const n = 2;
    const ifdOffset = 8;
    const bytes = new Uint8Array([
      ...ascii("II"), ...le16(42), ...le32(ifdOffset),
      ...le16(n),
      ...entryLE(513, LONG, 1, 0xffffff00),
      ...entryLE(514, LONG, 1, 64),
      ...le32(0),
    ]);
    expect(await extractRawPreview(fileOf(bytes))).toBeNull();
  });

  it("ignores a candidate whose bytes are not a JPEG", async () => {
    const notJpeg = new Uint8Array(64).fill(0x11);
    const bytes = new Uint8Array([
      ...ascii("II"), ...le16(42), ...le32(8),
      ...le16(2),
      ...entryLE(513, LONG, 1, 8 + 2 + 24 + 4),
      ...entryLE(514, LONG, 1, notJpeg.length),
      ...le32(0),
      ...notJpeg,
    ]);
    expect(await extractRawPreview(fileOf(bytes))).toBeNull();
  });

  it("returns null (no throw, bounded work) for a strip-count bomb", async () => {
    // Build a TIFF whose JPEG-compressed strip tag declares an absurd count.
    const bytes = new Uint8Array(50);
    bytes[0] = 0x49; bytes[1] = 0x49; bytes[2] = 42; bytes[3] = 0;
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 8, true); // IFD0 at 8
    view.setUint16(8, 3, true); // three entries
    // Entry 1: Compression (259) SHORT = 7
    view.setUint16(10, 259, true); view.setUint16(12, 3, true); view.setUint32(14, 1, true); view.setUint16(18, 7, true);
    // Entry 2: StripOffsets (273) LONG, count = 0x40000000
    view.setUint16(22, 273, true); view.setUint16(24, 4, true); view.setUint32(26, 0x40000000, true); view.setUint32(30, 8, true);
    // Entry 3: StripByteCounts (279) LONG = 1 — without it the parser bails at
    // the missing-tag check and the declared count is never read at all.
    view.setUint16(34, 279, true); view.setUint16(36, 4, true); view.setUint32(38, 1, true); view.setUint32(42, 1, true);
    view.setUint32(46, 0, true); // next IFD

    const file = new Blob([bytes]);
    await expect(extractRawPreview(file)).resolves.toBeNull();
  });

  it("rejects a strip set whose declared count exceeds MAX_STRIP_COUNT (1025)", async () => {
    // 1025 one-byte strips point at consecutive bytes of a region that is
    // itself a valid JPEG. Were the count guard absent this file would merge
    // to a real preview; the guard, not an incidental parse failure, rejects it.
    const jpeg = makeJpeg(1021); // 1025 bytes
    const offsets = Array.from({ length: 1025 }, (_, i) => i);
    await expect(extractRawPreview(fileOf(tiffStripTable(jpeg, 1, offsets)))).resolves.toBeNull();
  });

  it("rejects a strip set whose declared total exceeds MAX_PREVIEW_BYTES", async () => {
    // 1024 strips of 65537 bytes, all pointing at the SAME JPEG region:
    // overlapping strips keep the fixture ~68 KB while the declared total is
    // 64 MiB + 1 KiB. Each strip is file-bounded; the byte cap is what rejects it.
    const jpeg = makeJpeg(65533); // 65537 bytes
    const offsets = new Array<number>(1024).fill(0);
    await expect(extractRawPreview(fileOf(tiffStripTable(jpeg, jpeg.length, offsets)))).resolves.toBeNull();
  });
});
