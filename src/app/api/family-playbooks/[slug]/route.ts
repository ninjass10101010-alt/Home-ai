import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getPlaybook, patchPlaybook, archivePlaybook } from "@/lib/memory-playbooks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { slug } = await params;
  const playbook = await getPlaybook(decodeURIComponent(slug));
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, playbook });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { slug } = await params;
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const next = String(body?.body ?? "").trim();
  if (!next) {
    return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
  }
  const playbook = await patchPlaybook(decodeURIComponent(slug), next, "parent");
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, playbook });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { slug } = await params;
  const ok = await archivePlaybook(decodeURIComponent(slug));
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
