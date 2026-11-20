import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest, authorizeCurrentParentRequest } from "@/lib/server-auth";
import { ComposioError } from "@/lib/google/composio";
import {
  addVideoToYouTubePlaylist,
  composioHttpStatus,
  listYouTubePlaylistItems,
  removeYouTubePlaylistItem,
} from "@/lib/google/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params?: Promise<{ id?: string }> };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

async function resolvePlaylistId(req: NextRequest, context?: Ctx): Promise<string> {
  if (context?.params) {
    const resolved = await context.params;
    if (resolved?.id) return decodeURIComponent(resolved.id);
  }
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  // pathname .../playlists/:id/items
  return decodeURIComponent(parts[parts.length - 2] ?? "");
}

export async function GET(req: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentMemberRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  const playlistId = (await resolvePlaylistId(req, context)).trim();
  if (!playlistId) {
    return NextResponse.json({ ok: false, error: "invalid_playlist_id" }, { status: 400 });
  }
  try {
    const items = await listYouTubePlaylistItems(playlistId);
    return NextResponse.json({ ok: true, playlistId, items });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load playlist items" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentParentRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  const playlistId = (await resolvePlaylistId(req, context)).trim();
  if (!playlistId) {
    return NextResponse.json({ ok: false, error: "invalid_playlist_id" }, { status: 400 });
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

  try {
    const item = await addVideoToYouTubePlaylist(playlistId, videoId);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to add video to playlist" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, context?: Ctx) {
  const auth = await authorizeCurrentParentRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  await resolvePlaylistId(req, context);

  let playlistItemId = new URL(req.url).searchParams.get("playlistItemId")?.trim() ?? "";
  if (!playlistItemId) {
    const raw = await req.text().catch(() => "");
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed?.playlistItemId === "string") {
          playlistItemId = parsed.playlistItemId.trim();
        }
      } catch {
        return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
      }
    }
  }
  if (!playlistItemId) {
    return NextResponse.json({ ok: false, error: "playlist_item_id_required" }, { status: 400 });
  }

  try {
    await removeYouTubePlaylistItem(playlistItemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to remove item" },
      { status: 500 },
    );
  }
}
