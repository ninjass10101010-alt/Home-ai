import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { getServiceConfig } from "@/lib/services/config";
import { SERVICES_REGISTRY } from "@/lib/services/registry";

export const dynamic = "force-dynamic";

// Non-secret runtime values client widgets need (e.g. weather coordinates).
// Only registry fields flagged publicRuntime are exposed; everything else —
// and all secrets — stay server-side.
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const out: Record<string, Record<string, string>> = {};
  try {
    for (const svc of SERVICES_REGISTRY) {
      for (const field of svc.fields) {
        if (!field.publicRuntime) continue;
        const value = await getServiceConfig(svc.id, field.key);
        if (value !== null) {
          out[svc.id] = out[svc.id] || {};
          out[svc.id][field.key] = value;
        }
      }
    }
    return NextResponse.json({ runtime: out });
  } catch (err) {
    // Config store unreachable — widgets fall back to their own defaults,
    // so return an empty runtime (200) rather than breaking every caller.
    console.error("[services/runtime] GET failed:", err);
    return NextResponse.json({ runtime: out, error: "config_store_unreachable" });
  }
}
