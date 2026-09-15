import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { authorizeAdminRequest } from "@/lib/admin-auth";

// GET is session-level (read-only, middleware-gated). POST is SESSION + PARENT
// gated: it flips which alert categories fire, so authorizeAdminRequest
// rejects child/pet sessions with 403 adult_only.

const KEYS = ["briefing", "weather", "calendar"] as const;
type PrefKey = (typeof KEYS)[number];

export async function GET() {
  try {
    const rows = (await withAdmin(async (pb) =>
      pb.collection("ha_notify_prefs").getFullList()
    )) as Array<{ key: string; enabled?: boolean }>;
    const byKey = new Map(rows.map((r) => [r.key, r.enabled === true]));
    const prefs = Object.fromEntries(KEYS.map((k) => [k, byKey.get(k) ?? false])) as Record<PrefKey, boolean>;
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await authorizeAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { key, enabled } = (body ?? {}) as { key?: string; enabled?: boolean };
  if (!key || !KEYS.includes(key as PrefKey) || typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("ha_notify_prefs");
      try {
        const existing = await collection.getFirstListItem(`key="${key}"`);
        await collection.update(existing.id, { key, enabled });
      } catch (err) {
        if ((err as { status?: number })?.status === 404) {
          await collection.create({ key, enabled });
          return;
        }
        throw err;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
