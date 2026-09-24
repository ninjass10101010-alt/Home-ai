import type { NextRequest } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export interface LiveMember {
  id: string;
  name: string;
  role: string;
  emoji?: string;
  age?: number;
}

export type LiveParentAuth =
  | { ok: true; member: LiveMember }
  | { ok: false; status: 401 | 403 | 503; reason: string };

function sanitizeLiveMember(value: unknown): LiveMember | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id.trim() ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof row.role !== "string" ||
    !row.role.trim()
  ) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    ...(typeof row.emoji === "string" ? { emoji: row.emoji } : {}),
    ...(typeof row.age === "number" && Number.isFinite(row.age) ? { age: row.age } : {}),
  };
}

export async function getLiveMemberById(id: string): Promise<LiveMember | null> {
  const memberId = typeof id === "string" ? id.trim() : "";
  if (!memberId) return null;
  return withAdmin(async (pb) => {
    try {
      const row = await pb.collection("members").getOne(memberId, { requestKey: null });
      return sanitizeLiveMember(row);
    } catch (error: any) {
      if (error?.status === 404 || error?.response?.status === 404) return null;
      throw error;
    }
  });
}

export async function getLiveMembers(): Promise<LiveMember[]> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection("members").getFullList({ requestKey: null });
    return Array.isArray(rows)
      ? rows.map((row) => sanitizeLiveMember(row)).filter((member): member is LiveMember => member !== null)
      : [];
  });
}

export async function verifyLiveParentSession(request: NextRequest): Promise<LiveParentAuth> {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return { ok: false, status: 401, reason: "unauthorized" };

  try {
    const member = await getLiveMemberById(session.memberId);
    if (!member) return { ok: false, status: 401, reason: "member_missing" };
    if (member.role !== "parent") return { ok: false, status: 403, reason: "adult_only" };
    return { ok: true, member };
  } catch {
    return { ok: false, status: 503, reason: "member_lookup_failed" };
  }
}
