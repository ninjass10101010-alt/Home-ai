import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { isHAServiceAllowed } from "@/lib/ha/service-allowlist";

// NOTE (accepted risk): this route is intentionally UNAUTHENTICATED. The
// dashboard is LAN-only and the product decision is that HA controls are not
// PIN-gated for family convenience. Do not expose this app to the internet.
// If remote access is ever added, add a bearer/PIN gate here first.
//
// Unauthenticated does NOT mean unrestricted: only an explicit allowlist of
// domain/service pairs (the ones the House tab UI uses) is forwarded to Home
// Assistant — see src/lib/ha/service-allowlist.ts. Everything else, including
// locks, scripts, automations, shell_command and alarm arm_away/trigger,
// is rejected with 403.

const NAME_PATTERN = /^[a-z0-9_]+$/;
const MAX_NAME_LENGTH = 64;

export async function POST(req: Request) {
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

    const result = await getHAWebSocketClient().callService(
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
