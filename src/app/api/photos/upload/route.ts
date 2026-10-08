import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import {
  MAX_ORIGINAL_BYTES,
  MAX_WALL_BYTES,
  isAllowedImageType,
  isAllowedOriginalFile,
} from "@/lib/photos/upload-limits";

export const dynamic = "force-dynamic";

/**
 * Ceiling on the raw multipart body, checked from `Content-Length` before the
 * body is parsed: original (100 MB) + wall copy (8 MB) + part headers. The 8 MB
 * slack is exactly `MAX_WALL_BYTES`, which is also the most a wall part can add
 * — an oversized body is refused without ever being buffered into a FormData.
 */
const MAX_BODY_BYTES = MAX_ORIGINAL_BYTES + MAX_WALL_BYTES;

function fileFrom(bytes: Uint8Array, name: string, type: string): Blob {
  // The PocketBase client accepts File/Blob/ArrayBuffer for file fields; Node
  // has had a global File since 20, but fall back rather than assume it.
  const copy = bytes.slice();
  if (typeof File !== "undefined") return new File([copy], name, { type });
  return new Blob([copy], { type });
}

/** Any signed-in family member can add a picture; the wall itself never uploads. */
async function requireSession(request: NextRequest) {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Refuse an oversized body before `formData()` buffers it (spec §6.2: a
  // 100 MB multipart round-trips several full copies, so don't start).
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form" }, { status: 400 });
  }

  const original = form.get("original");
  if (!(original instanceof File) || original.size === 0) {
    return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  }
  // The archive accepts RAW originals too (DNG/CR2/NEF/…): the browser often
  // declares no type for them, so the extension is part of the check.
  if (!isAllowedOriginalFile(original)) {
    return NextResponse.json({ ok: false, error: "unsupported_type" }, { status: 400 });
  }
  if (original.size > MAX_ORIGINAL_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }

  const wall = form.get("wall");
  if (wall instanceof File && wall.size > 0 && !isAllowedImageType(wall.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_wall_type" }, { status: 400 });
  }
  if (wall instanceof File && wall.size > MAX_WALL_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }

  const takenAt = String(form.get("takenAt") ?? "");
  // Absent is fine (`takenAt` is optional); a value that won't parse would be
  // stored as an Invalid Date, so reject it where the message still makes sense.
  if (takenAt && Number.isNaN(Date.parse(takenAt))) {
    return NextResponse.json({ ok: false, error: "invalid_taken_at" }, { status: 400 });
  }
  const caption = String(form.get("caption") ?? "").trim();
  const album = String(form.get("album") ?? "").trim();
  const width = Number(form.get("width")) || undefined;
  const height = Number(form.get("height")) || undefined;
  // A RAW whose embedded preview could not be extracted has no displayable
  // bytes; the client marks it so it is archived honestly and kept off the wall
  // instead of rendering as a broken tile.
  const noWall = String(form.get("noWall") ?? "") === "true";

  try {
    const data: Record<string, unknown> = {
      original: fileFrom(new Uint8Array(await original.arrayBuffer()), original.name, original.type),
      showOnWall: !noWall,
      uploadedBy: session.memberId,
    };
    if (wall instanceof File && wall.size > 0) {
      data.wall = fileFrom(new Uint8Array(await wall.arrayBuffer()), wall.name, wall.type || "image/jpeg");
    }
    if (takenAt) data.takenAt = new Date(takenAt).toISOString();
    if (caption) data.caption = caption.slice(0, 200);
    if (album) data.album = album.slice(0, 80);
    if (width) data.width = width;
    if (height) data.height = height;

    const record = await withAdmin(async (pb) => pb.collection("photos").create(data));
    return NextResponse.json({ ok: true, id: String(record.id) }, { status: 201 });
  } catch (err) {
    // Message only — an upload failure must never log file bytes or form data.
    console.error("[photos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
