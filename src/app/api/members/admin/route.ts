import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { createMemberRecord, findMemberByName, listMembersSanitized, sanitizeMember } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { authorizeAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Members admin surface for Settings → Family Members, replacing the old
// client-direct PB writes (db.insertMember / db.updateMember / db.deleteMember)
// that broke once PB rules locked down and that were insecure anyway.
//
//   GET    — any VALID SESSION (adult or child): read-only sanitized roster.
//   POST   — adults only (same gate as PATCH/DELETE): create a member. The body
//            may never carry a pin — a server-side seed-side default is
//            resolved for the name so the new member can log in. Duplicate
//            names → 409 {error:"duplicate"}.
//   PATCH  — adults only: update a member by resolved id.
//   DELETE — same adult gate; refuses to delete the last parent-role member.

export async function GET(request: NextRequest) {
  try {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    const member = await createMemberRecord(body);
    if (!member) {
      return NextResponse.json({ error: "duplicate" }, { status: 409 });
    }
    return NextResponse.json({ member: sanitizeMember(member) }, { status: 201 });
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
    const { name, patch } = await request.json();
    if (!name || !patch || typeof patch !== "object") {
      return NextResponse.json({ error: "name and patch are required" }, { status: 400 });
    }
    const member = await findMemberByName(String(name));
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const updated = await withAdmin((pb) => pb.collection("members").update(member.id, patch));
    return NextResponse.json({ member: sanitizeMember(updated ?? member) });
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
    const { name } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const member = await findMemberByName(String(name));
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const all = await listMembersSanitized();
    if (member.role === "parent" && all.filter((m: any) => m.role === "parent").length <= 1) {
      return NextResponse.json({ error: "last_parent" }, { status: 400 });
    }
    await withAdmin((pb) => pb.collection("members").delete(member.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Members admin DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete member" }, { status: 500 });
  }
}
