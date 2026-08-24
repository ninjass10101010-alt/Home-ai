import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

// Arm/disarm is a HUMAN-ONLY action: unlike /api/ha/call-service (LAN
// convenience controls), every request here must carry a valid family-member
// PIN, verified server-side against PocketBase. This route is the ONLY path to
// alarm_control_panel services — the general call-service allowlist and the
// LLM chat tool layer both exclude alarms by design.

const ACTIONS: Record<string, string> = {
  arm_home: "alarm_arm_home",
  disarm: "alarm_disarm",
};

const ENTITY_PATTERN = /^alarm_control_panel\.[a-z0-9_]+$/;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, entity_id: entityId, pin } = body ?? {};

    const service =
      typeof action === "string" ? ACTIONS[action] : undefined;
    const validEntity =
      typeof entityId === "string" &&
      entityId.length <= 64 &&
      ENTITY_PATTERN.test(entityId);

    if (!service || !validEntity) {
      return NextResponse.json(
        { success: false, error: "invalid_request" },
        { status: 400 }
      );
    }

    // Missing AND incorrect pins are the same signal to callers: 401.
    const member =
      typeof pin === "string" && pin.length > 0
        ? await verifyPinAgainstAnyMember(pin)
        : null;
    if (!member) {
      return NextResponse.json(
        { success: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    await getHAWebSocketClient().callService(
      "alarm_control_panel",
      service,
      { entity_id: entityId }
    );
    return NextResponse.json({ success: true });
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
