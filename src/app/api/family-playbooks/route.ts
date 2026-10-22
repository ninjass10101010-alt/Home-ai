import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listActivePlaybooks, writePlaybook } from "@/lib/memory-playbooks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const playbooks = await listActivePlaybooks();
  return NextResponse.json({ ok: true, playbooks });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const slug = String(body?.slug ?? "").trim();
  const title = String(body?.title ?? "").trim();
  const playbookBody = String(body?.body ?? "").trim();
  if (!slug || !title || !playbookBody) {
    return NextResponse.json({ ok: false, error: "slug, title and body are required" }, { status: 400 });
  }
  const playbook = await writePlaybook({
    slug,
    title,
    body: playbookBody,
    domain: typeof body?.domain === "string" ? body.domain : undefined,
    trigger: typeof body?.trigger === "string" ? body.trigger : undefined,
    createdBy: "parent",
  });
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "playbook store is unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, playbook }, { status: 201 });
}
