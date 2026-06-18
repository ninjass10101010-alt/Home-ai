import { NextResponse } from "next/server";
import { listContainers } from "@/lib/docker-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainers(
      "consuela-dashboard",
      "pocketbase",
      "hermes-agent-2",
    );
    return NextResponse.json({ ok: true, containers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to list containers" },
      { status: 500 },
    );
  }
}
