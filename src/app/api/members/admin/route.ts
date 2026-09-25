import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { createMemberRecord, findLiveMemberByExactName, findLiveMemberById, isMemberPinAvailable, listLiveMembersSanitized, listMembersSanitized, sanitizeMember, withMemberAdminOperation } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { authorizeAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const ALLOWED_MEMBER_ROLES = new Set(["parent", "child", "pet"]);

function normalizedMemberName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Members admin surface for Settings → Family Members, replacing the old
// client-direct PB writes (db.insertMember / db.updateMember / db.deleteMember)
// that broke once PB rules locked down and that were insecure anyway.
//
//   GET    — any VALID SESSION (adult or child): read-only sanitized roster.
//   POST   — adults only: create a member with a server-resolved PIN. Exact
//            normalized full-name duplicates return 409 {error:"duplicate"}.
//   PATCH  — adults only: update an exact live PB ID; normalized duplicate
//            names are rejected before mutation.
//   DELETE — adults only by exact live PB ID; refuses to delete the last
//            parent-role member.

export async function GET(request: NextRequest) {
  try {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const source = request.nextUrl.searchParams.get("source");
    if (source === "live") {
      const members = await listLiveMembersSanitized();
      return NextResponse.json({ members, source: "live" });
    }
    const members = await listMembersSanitized();
    return NextResponse.json({ members });
  } catch (error) {
    console.error("Members admin GET error:", error);
    return NextResponse.json({ error: "Failed to list members" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const body = await request.json();
    if (!body || typeof body !== "object" || !body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof body.role !== "string" || !ALLOWED_MEMBER_ROLES.has(body.role)) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    const member = await createMemberRecord(body);
    if (!member) {
      return NextResponse.json({ error: "duplicate" }, { status: 409 });
    }
    const starterPin = typeof member.pin === "string" && /^\d{4}$/.test(member.pin)
      ? member.pin
      : undefined;
    return NextResponse.json({
      member: sanitizeMember(member),
      ...(starterPin ? { starterPin } : {}),
    }, { status: 201 });
  } catch (error) {
    console.error("Members admin POST error:", error);
    return NextResponse.json({ error: "Failed to create member" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const { id, name, patch } = await request.json();
    if ((!id && !name) || !patch || typeof patch !== "object") {
      return NextResponse.json({ error: "id and patch are required" }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "role") && !ALLOWED_MEMBER_ROLES.has(patch.role)) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
    return withMemberAdminOperation(async () => {
      const member = typeof id === "string"
        ? await findLiveMemberById(id)
        : await findLiveMemberByExactName(typeof name === "string" ? name : undefined);
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        if (typeof patch.name !== "string" || !patch.name.trim()) {
          return NextResponse.json({ error: "invalid_name" }, { status: 400 });
        }
        const nextName = patch.name.trim().replace(/\s+/g, " ");
        const duplicate = await withAdmin(async (pb) => {
          const records = await pb.collection("members").getFullList({ requestKey: null });
          return records.some((row: any) => String(row.id) !== String(member.id) && normalizedMemberName(row.name) === normalizedMemberName(nextName));
        });
        if (duplicate) return NextResponse.json({ error: "duplicate" }, { status: 409 });
        patch.name = nextName;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "pin")) {
        if (typeof patch.pin !== "string") {
          return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
        }
        if (!patch.pin.trim()) {
          delete patch.pin;
        } else if (!/^\d{4}$/.test(patch.pin)) {
          return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
        } else if (!await isMemberPinAvailable(patch.pin, member.id)) {
          return NextResponse.json({ error: "pin_collision" }, { status: 409 });
        }
      }
      const nextRole = typeof patch.role === "string" ? patch.role.toLowerCase() : String(member.role || "").toLowerCase();
      if (nextRole !== "parent" && String(member.role || "").toLowerCase() === "parent") {
        const liveMembers = await listLiveMembersSanitized();
        if (liveMembers.filter((m: any) => String(m.role || "").toLowerCase() === "parent").length <= 1) {
          return NextResponse.json({ error: "last_parent" }, { status: 400 });
        }
      }
      const updated = await withAdmin((pb) => pb.collection("members").update(member.id, patch));
      return NextResponse.json({ member: sanitizeMember(updated ?? member) });
    });
  } catch (error) {
    console.error("Members admin PATCH error:", error);
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
    const { id, name } = await request.json();
    if (!id && !name) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    return withMemberAdminOperation(async () => {
      const member = typeof id === "string"
        ? await findLiveMemberById(id)
        : await findLiveMemberByExactName(typeof name === "string" ? name : undefined);
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      if (String(member.role || "").toLowerCase() === "parent") {
        const all = await listLiveMembersSanitized();
        if (all.filter((m: any) => String(m.role || "").toLowerCase() === "parent").length <= 1) {
          return NextResponse.json({ error: "last_parent" }, { status: 400 });
        }
      }
      await withAdmin((pb) => pb.collection("members").delete(member.id));
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error("Members admin DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete member" }, { status: 500 });
  }
}
