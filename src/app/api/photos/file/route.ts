import { NextRequest, NextResponse } from "next/server";
import { ensureAuth, withAdmin } from "@/lib/pb-auth";
import { PB_RECORD_ID as PB_ID } from "@/db/features/photos";

export const dynamic = "force-dynamic";

const PB_ORIGIN = (process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090").replace(/\/+$/, "");

/**
 * Same-origin photo bytes.
 *
 * Why a proxy instead of pointing `<img>` at PocketBase: the file token that
 * guards a non-public collection is minted by whoever asks for it, so a browser
 * would need an admin-scoped token sitting in the panel's HTML. Here the token
 * never leaves the server, the internal `pocketbase:8090` hostname never reaches
 * a client, and this route decides the cache policy.
 *
 * The `f` param is a cache key, not an instruction: it is verified against the
 * record and rejected on mismatch, so no request can name a file the record
 * doesn't actually hold, or reach another collection.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("r") ?? "";
  const claimed = params.get("f") ?? "";
  const wantsOriginal = params.get("s") === "original";

  if (!PB_ID.test(id)) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const payload = await withAdmin(async (pb) => {
      const record = await pb.collection("photos").getOne(id);
      const wall = String(record?.wall ?? "");
      const original = String(record?.original ?? "");
      const filename = wantsOriginal ? original || wall : wall || original;
      if (!filename) throw new Error("record has no image file");
      if (claimed && claimed !== filename) throw new Error("filename mismatch");

      // The admin JWT travels as a request header rather than as a minted file
      // token: file tokens are designed to stand in for an *auth record*, and
      // this collection has none. The header keeps the credential server-side
      // and needs nothing stored on the record.
      const token = await ensureAuth();
      const url = `${PB_ORIGIN}/api/files/photos/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;
      const res = await fetch(url, {
        headers: { Authorization: token },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`PocketBase returned ${res.status}`);

      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "image/jpeg",
        filename,
      };
    });

    return new Response(payload.bytes as BodyInit, {
      headers: {
        "content-type": payload.contentType,
        "content-length": String(payload.bytes.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

export async function POST() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
