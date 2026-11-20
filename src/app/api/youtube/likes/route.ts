import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest, authorizeCurrentParentRequest } from "@/lib/server-auth";
import { ComposioError } from "@/lib/google/composio";
import {
  composioHttpStatus,
  listYouTubeLikedVideos,
  rateYouTubeVideo,
} from "@/lib/google/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export async function GET(req: NextRequest) {
  const auth = await authorizeCurrentMemberRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  try {
    const tracks = await listYouTubeLikedVideos();
    return NextResponse.json({ ok: true, tracks });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load YouTube likes" },
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

  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ ok: false, error: "invalid_video_id" }, { status: 400 });
  }
  const rating = body.rating;
  if (rating !== "like" && rating !== "none") {
    return NextResponse.json({ ok: false, error: "invalid_rating" }, { status: 400 });
  }

  try {
    await rateYouTubeVideo(videoId, rating);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to rate video" },
      { status: 500 },
    );
  }
}
