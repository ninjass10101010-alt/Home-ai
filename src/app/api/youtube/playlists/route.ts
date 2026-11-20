import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest, authorizeCurrentParentRequest } from "@/lib/server-auth";
import { ComposioError } from "@/lib/google/composio";
import {
  composioHttpStatus,
  createYouTubePlaylist,
  listYouTubePlaylists,
} from "@/lib/google/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_PRIVACY = new Set(["private", "unlisted", "public"] as const);

export async function GET(req: NextRequest) {
  const auth = await authorizeCurrentMemberRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  try {
    const playlists = await listYouTubePlaylists();
    return NextResponse.json({ ok: true, playlists });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load YouTube playlists" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCurrentParentRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const rawPrivacy = body.privacyStatus;
  if (rawPrivacy !== undefined && !VALID_PRIVACY.has(rawPrivacy as "private" | "unlisted" | "public")) {
    return NextResponse.json({ ok: false, error: "invalid_privacy_status" }, { status: 400 });
  }

  try {
    const playlist = await createYouTubePlaylist({
      title,
      description,
      privacyStatus: (rawPrivacy as "private" | "unlisted" | "public" | undefined) ?? "private",
    });
    return NextResponse.json({ ok: true, playlist });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create playlist" },
      { status: 500 },
    );
  }
}
