import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyPinFromPB, sanitizeMember, findOrCreateMemberRecord } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = ["emoji", "avatarSize", "glow", "color"] as const;
// Must stay in lockstep with the seed's members.emoji field max (pb-seed.ts) —
// the client resizes photos to a base64 data URL that can exceed PocketBase's
// built-in 5000-char text default, so both caps have to agree.
export const MAX_AVATAR_CHARS = 400_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actorName, actorPin, patch } = body || {};

    if (!actorName || !actorPin) {
      return NextResponse.json({ error: "actorName and actorPin are required" }, { status: 400 });
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return NextResponse.json({ error: "patch must be an object" }, { status: 400 });
    }

    const actor = await verifyPinFromPB(actorName, actorPin);
    if (!actor) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const clean: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (!(key in patch)) continue;
      let value = patch[key];
      if (key === "emoji") {
        if (typeof value !== "string" || value.length === 0) continue;
        if (value.length > MAX_AVATAR_CHARS) {
          return NextResponse.json({ error: "Avatar too large. Try a smaller photo." }, { status: 413 });
        }
        clean[key] = value;
      } else if (key === "glow") {
        clean[key] = Boolean(value);
      } else if (key === "avatarSize") {
        if (!["xs", "sm", "md", "base", "lg"].includes(value)) continue;
        clean[key] = value;
      } else if (key === "color") {
        if (typeof value !== "string" || value.length > 30) continue;
        clean[key] = value;
      }
    }

    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await withAdmin(async (pb) => {
      return findOrCreateMemberRecord(pb, actor, clean);
    });

    return NextResponse.json({ success: true, member: sanitizeMember(updated) });
  } catch (error) {
    console.error("Member profile API error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
