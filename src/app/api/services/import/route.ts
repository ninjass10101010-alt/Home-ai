import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { encryptSecret } from "@/lib/secret-box";
import { isRegistryPair, isSecretPair } from "@/lib/services/registry";
import { getServiceConfig } from "@/lib/services/config";

export const dynamic = "force-dynamic";

// One-time ingest of the legacy localStorage "consuela-connections" blob.
// Adults-only; every entry is validated against the registry and secrets are
// encrypted on write. Unknown pairs come back in `rejected` with a reason.
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    const body = await request.json();
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    if (entries.length === 0 || entries.length > 100) {
      return NextResponse.json({ ok: false, error: "invalid_entries" }, { status: 400 });
    }

    let imported = 0;
    const rejected: Array<{ service: string; key: string; reason: string }> = [];

    await withAdmin(async (pb) => {
      for (const entry of entries) {
        const service = String(entry?.service ?? "");
        const key = String(entry?.key ?? "");
        const value = entry?.value;

        if (!isRegistryPair(service, key)) {
          rejected.push({ service, key, reason: "unknown_pair" });
          continue;
        }
        if (typeof value !== "string" || value === "" || value.length > 2000) {
          rejected.push({ service, key, reason: "invalid_value" });
          continue;
        }
        // Skip entries that would just mirror what's already configured.
        const current = await getServiceConfig(service, key);
        if (current === value) {
          rejected.push({ service, key, reason: "already_configured" });
          continue;
        }

        const isSecret = isSecretPair(service, key);
        const payload = {
          service,
          key,
          value: isSecret ? encryptSecret(value) : value,
          is_secret: isSecret,
          updated_at: new Date().toISOString(),
          updated_by: session?.name || "admin-secret",
        };
        const rows = (await pb
          .collection("consuela_service_config")
          .getFullList({
            requestKey: null,
            filter: `service = "${service}" && key = "${key}"`,
          })) as any[];
        if (rows[0]) {
          await pb.collection("consuela_service_config").update(rows[0].id, payload, { requestKey: null });
        } else {
          await pb.collection("consuela_service_config").create(payload, { requestKey: null });
        }
        imported++;
      }
    });

    return NextResponse.json({ ok: true, imported, rejected });
  } catch (err) {
    console.error("[services/import] failed:", err);
    return NextResponse.json({ ok: false, error: "import_failed" }, { status: 500 });
  }
}
