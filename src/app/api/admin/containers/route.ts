import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const ALLOWED_CONTAINERS = ["consuela-dashboard", "pocketbase", "hermes-agent-2"];

export async function GET() {
  try {
    const result = execSync(
      `docker ps --format '{{json .}}' --filter "name=consuela-dashboard" --filter "name=pocketbase" --filter "name=hermes-agent-2"`,
      { encoding: "utf8", timeout: 10000 },
    );
    const lines = result.trim().split("\n").filter(Boolean);
    const containers = lines.map((line) => {
      try {
        const c = JSON.parse(line);
        return {
          name: c.Names,
          image: c.Image,
          status: c.Status,
          state: c.State,
          ports: c.Ports,
          created: c.CreatedAt,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return NextResponse.json({ ok: true, containers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to list containers" },
      { status: 500 },
    );
  }
}
