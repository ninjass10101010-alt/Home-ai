import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { sanitizeMember, verifyPinForMemberId, findOrCreateMemberRecord, withMemberAdminOperation } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = ["emoji", "avatarSize", "glow", "color"] as const;
export const MAX_AVATAR_CHARS = 400_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actorPin, patch } = body || {};
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return NextResponse.json({ error: "patch must be an object" }, { status: 400 });
    }
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const result = await withMemberAdminOperation(async () => {
      const member = await withAdmin(async (pb) => {
        try {
          return await pb.collection("members").getOne(session.memberId, { requestKey: null });
        } catch {
          return null;
        }
      });
      if (!member) return { error: "Invalid session" as const, status: 401 as const };

      const hasActorPin = typeof actorPin === "string" && actorPin.length > 0;
      if (hasActorPin) {
        const verified = await verifyPinForMemberId(session.memberId, actorPin);
        if (!verified) return { error: "Invalid PIN" as const, status: 401 as const };
      } else if (String(member.role || "").toLowerCase() !== "child") {
        return { error: "Invalid PIN" as const, status: 401 as const };
      }

      const nonAvatarKeys = Object.keys(patch).filter((key) => !["emoji", "avatarSize", "glow"].includes(key));
      if (String(member.role || "").toLowerCase() === "child" && !hasActorPin && nonAvatarKeys.length > 0) {
        return { error: "Avatar fields only on a child session" as const, status: 401 as const };
      }

      const clean: Record<string, unknown> = {};
      for (const key of ALLOWED_FIELDS) {
        if (!(key in patch)) continue;
        const value = patch[key];
        if (key === "emoji") {
          if (typeof value !== "string" || value.length === 0) continue;
          if (value.length > MAX_AVATAR_CHARS) {
            return { error: "Avatar too large. Try a smaller photo." as const, status: 413 as const };
          }
          clean[key] = value;
        } else if (key === "glow") {
          clean[key] = Boolean(value);
        } else if (key === "avatarSize") {
          if (["xs", "sm", "md", "base", "lg"].includes(value)) clean[key] = value;
        } else if (key === "color") {
          if (typeof value === "string" && value.length <= 30) clean[key] = value;
        }
      }

      if (Object.keys(clean).length === 0) {
        return { error: "No valid fields to update" as const, status: 400 as const };
      }
      const updated = await withAdmin((pb) => findOrCreateMemberRecord(pb, member, clean));
      if (!updated) return { error: "Invalid session" as const, status: 401 as const };
      return { member: sanitizeMember(updated), status: 200 as const };
    });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, member: result.member });
  } catch (error) {
    console.error("Member profile API error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
