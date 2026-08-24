import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { restartContainer } from "@/lib/docker-api";

export const dynamic = "force-dynamic";

const ALLOWED = ["consuela-dashboard", "pocketbase", "hermes-agent-2"];

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: { container?: string };
  try {
    body = await request.json();
  } catch (e: any) {
    console.error("[admin/restart]", e);
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.container;
  if (!name) {
    return NextResponse.json({ ok: false, error: "container name required" }, { status: 400 });
  }
  if (!ALLOWED.includes(name)) {
    return NextResponse.json(
      { ok: false, error: `Container "${name}" not in allowed list: ${ALLOWED.join(", ")}` },
      { status: 403 },
    );
  }

  try {
    await restartContainer(name);
    return NextResponse.json({
      ok: true,
      message: `Container "${name}" restarted successfully`,
    });
  } catch (e: any) {
    console.error("[admin/restart]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || `Failed to restart ${name}` },
      { status: 500 },
    );
  }
}
