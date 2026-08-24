import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listContainers } from "@/lib/docker-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const containers = await listContainers(
      "consuela-dashboard",
      "pocketbase",
      "hermes-agent-2",
    );
    return NextResponse.json({ ok: true, containers });
  } catch (e: any) {
    console.error("[admin/containers]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to list containers" },
      { status: 500 },
    );
  }
}
