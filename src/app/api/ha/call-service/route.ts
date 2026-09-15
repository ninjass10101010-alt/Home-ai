import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { isHAServiceAllowed } from "@/lib/ha/service-allowlist";
import { authorizeAdminRequest } from "@/lib/admin-auth";

// SESSION + PARENT gated: middleware requires a signed-in session on /api/**,
// and this route additionally runs authorizeAdminRequest (the parent allowlist
// shared with the admin routes / planner-apply). A child OR pet session is 403
// adult_only, so kids and pets cannot control devices.
//
// Defense in depth: only an explicit allowlist of domain/service pairs (the
// ones the House tab UI uses) is forwarded to Home Assistant — see
// src/lib/ha/service-allowlist.ts. Everything else, including locks, scripts,
// automations, shell_command and alarm arm_away/trigger, is rejected with 403.
// (Alarm arm/disarm has its own human PIN gate at /api/ha/alarm.)

const NAME_PATTERN = /^[a-z0-9_]+$/;
const MAX_NAME_LENGTH = 64;

export async function POST(req: Request) {
  const auth = await authorizeAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const { domain, service, serviceData } = body ?? {};

    const validDomain =
      typeof domain === "string" &&
      domain.length > 0 &&
      domain.length <= MAX_NAME_LENGTH &&
      NAME_PATTERN.test(domain);
    const validService =
      typeof service === "string" &&
      service.length > 0 &&
      service.length <= MAX_NAME_LENGTH &&
      NAME_PATTERN.test(service);
    const validServiceData =
      serviceData === undefined ||
      (typeof serviceData === "object" &&
        serviceData !== null &&
        !Array.isArray(serviceData));

    if (!validDomain || !validService || !validServiceData) {
      return NextResponse.json(
        { success: false, error: "invalid_request" },
        { status: 400 }
      );
    }

    if (!isHAServiceAllowed(domain, service)) {
      return NextResponse.json(
        { success: false, error: "service_not_allowed" },
        { status: 403 }
      );
    }

    const result = await (await getHAWebSocketClient()).callService(
      domain,
      service,
      serviceData
    );
    return NextResponse.json({ success: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
