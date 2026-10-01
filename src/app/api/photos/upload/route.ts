import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Archive copy is kept as uploaded; the wall copy is the resized JPEG. */
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const MAX_WALL_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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
  if (!ALLOWED_TYPES.has(original.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_type" }, { status: 400 });
  }
  if (original.size > MAX_ORIGINAL_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }

  const wall = form.get("wall");
  if (wall instanceof File && wall.size > MAX_WALL_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }

  const takenAt = String(form.get("takenAt") ?? "");
  const caption = String(form.get("caption") ?? "").trim();
  const album = String(form.get("album") ?? "").trim();
  const width = Number(form.get("width")) || undefined;
  const height = Number(form.get("height")) || undefined;

  try {
    const data: Record<string, unknown> = {
      original: fileFrom(new Uint8Array(await original.arrayBuffer()), original.name, original.type),
      showOnWall: true,
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
  } catch {
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
