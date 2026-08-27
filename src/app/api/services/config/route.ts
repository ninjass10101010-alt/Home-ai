import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { encryptSecret } from "@/lib/secret-box";
import {
  SERVICES_REGISTRY,
  isRegistryPair,
  isSecretPair,
} from "@/lib/services/registry";
import { getServiceStatus } from "@/lib/services/config";

export const dynamic = "force-dynamic";

function requireSession(request: NextRequest) {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

// GET: manifest + per-field status. Secret VALUES never leave the server —
// only a 2-char suffix hint so the owner can tell which key is in use.
export async function GET(request: NextRequest) {
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const services = await Promise.all(
      SERVICES_REGISTRY.map(async (svc) => ({
        id: svc.id,
        displayName: svc.displayName,
        description: svc.description,
        testFnId: svc.testFnId,
        status: await getServiceStatus(svc.id),
      }))
    );
    return NextResponse.json({ services });
  } catch (err) {
    // PocketBase unreachable (or the config collection missing) — return an
    // honest, parseable error instead of a bare 500 with an empty body.
    console.error("[services/config] GET failed:", err);
    return NextResponse.json(
      { services: [], error: "config_store_unreachable" },
      { status: 503 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  try {
    const { service, key, value } = await request.json();
    if (
      typeof service !== "string" ||
      typeof key !== "string" ||
      typeof value !== "string" ||
      value.length > 2000 ||
      !isRegistryPair(service, key)
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_service_key" },
        { status: 400 }
      );
    }

    const isSecret = isSecretPair(service, key);
    const stored = isSecret ? encryptSecret(value) : value;
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

    await withAdmin(async (pb) => {
      const rows = (await pb
        .collection("consuela_service_config")
        .getFullList({
          requestKey: null,
          filter: `service = "${service}" && key = "${key}"`,
        })) as any[];
      const payload = {
        service,
        key,
        value: stored,
        is_secret: isSecret,
        updated_at: new Date().toISOString(),
        updated_by: session?.name || "admin-secret",
      };
      if (rows[0]) {
        await pb.collection("consuela_service_config").update(rows[0].id, payload, {
          requestKey: null,
        });
      } else {
        await pb.collection("consuela_service_config").create(payload, {
          requestKey: null,
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[services/config] PUT failed:", err);
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  try {
    const { service, key } = await request.json();
    if (typeof service !== "string" || typeof key !== "string" || !isRegistryPair(service, key)) {
      return NextResponse.json(
        { ok: false, error: "invalid_service_key" },
        { status: 400 }
      );
    }

    await withAdmin(async (pb) => {
      const rows = (await pb
        .collection("consuela_service_config")
        .getFullList({
          requestKey: null,
          filter: `service = "${service}" && key = "${key}"`,
        })) as any[];
      for (const row of rows) {
        await pb.collection("consuela_service_config").delete(row.id, { requestKey: null });
      }
    });

    // Idempotent: clearing a non-existent override still means "env wins".
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[services/config] DELETE failed:", err);
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }
}
