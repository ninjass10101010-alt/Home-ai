import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { authorizeAdminRequest } from "@/lib/admin-auth";

// SESSION + PARENT gated: middleware requires a session on /api/**, and this
// route runs authorizeAdminRequest so only a parent can change which phones
// receive house alerts. Child/pet sessions get 403 adult_only.

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
  const { target, enabled } = (body ?? {}) as { target?: string; enabled?: boolean };

  if (typeof target !== "string" || target.trim().length === 0 || typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("ha_notify_config");
      const normalized = target.startsWith("notify.") ? target : `notify.${target}`;
      try {
        const existing = await collection.getFirstListItem(`target="${normalized}"`);
        await collection.update(existing.id, { target: normalized, channel: "ha", enabled });
      } catch (err) {
        if ((err as { status?: number })?.status === 404) {
          await collection.create({ target: normalized, channel: "ha", enabled });
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
