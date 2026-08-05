import { NextRequest, NextResponse } from "next/server";
import { restartContainer } from "@/lib/docker-api";

export const dynamic = "force-dynamic";

const ALLOWED = ["consuela-dashboard", "pocketbase", "hermes-agent-2"];

export async function POST(request: NextRequest) {
  let body: { container?: string };
  try {
    body = await request.json();
  } catch {
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
    return NextResponse.json(
      { ok: false, error: e?.message || `Failed to restart ${name}` },
      { status: 500 },
    );
  }
}
