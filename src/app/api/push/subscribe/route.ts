import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { requireLiveSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SUBS_PER_MEMBER = 6;

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  deviceLabel?: string;
}

function isSubscribeBody(value: unknown): value is Required<Pick<SubscribeBody, "endpoint" | "keys">> & SubscribeBody {
  if (!value || typeof value !== "object") return false;
  const v = value as SubscribeBody;
  return (
    typeof v.endpoint === "string" &&
    v.endpoint.length > 0 &&
    !!v.keys &&
    typeof v.keys.p256dh === "string" &&
    typeof v.keys.auth === "string"
  );
}

export async function POST(request: Request) {
  const auth = await requireLiveSession(request, { withMember: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!isSubscribeBody(body)) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

  const memberName = auth.identity.name;
  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("push_subscriptions");
      const payload = {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        memberName,
        deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : "",
      };
      let existing: { id: string } | null = null;
      try {
        existing = (await collection.getFirstListItem(`endpoint="${body.endpoint.replace(/"/g, "")}"`)) as { id: string };
      } catch (err) {
        if ((err as { status?: number })?.status !== 404) throw err;
      }
      if (existing) {
        await collection.update(existing.id, payload);
        return;
      }
      await collection.create(payload);

      const mine = (await collection.getFullList({
        filter: `memberName="${memberName.replace(/"/g, "")}"`,
        sort: "-created",
      })) as Array<{ id: string }>;
      for (const extra of mine.slice(MAX_SUBS_PER_MEMBER)) {
        await collection.delete(extra.id);
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

export async function DELETE(request: Request) {
  const auth = await requireLiveSession(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { endpoint?: string };
  try {
    body = (await request.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const endpoint = body.endpoint;
  if (!endpoint) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

  try {
    await withAdmin(async (pb) => {
      const collection = pb.collection("push_subscriptions");
      try {
        const row = await collection.getFirstListItem(`endpoint="${endpoint.replace(/"/g, "")}"`);
        await collection.delete((row as { id: string }).id);
      } catch (err) {
        if ((err as { status?: number })?.status !== 404) throw err;
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
