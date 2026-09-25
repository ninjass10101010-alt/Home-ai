import { NextRequest, NextResponse } from "next/server";
import { liveEmergencyContacts } from "@/lib/consuela/live-reads";
import { resolveGmailCredentials, sendSMSViaEmail, sendEmailAlert } from "@/lib/free-communication";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const EMERGENCY_PIN_HEADER = "x-emergency-pin";
// Read lazily (per request) so tests can stub the env var via vi.stubEnv;
// runtime behavior is identical to capturing it at module load.
const emergencyPinBypass = () => process.env.EMERGENCY_PIN_BYPASS || "";

export const EMERGENCY_ALERT_COOLDOWN_MS = 30_000;

interface EmergencyAlertGuard {
  inFlight: boolean;
  cooldownUntil: number;
  deliveryStarted: boolean;
}

const emergencyAlertGuards = new Map<string, EmergencyAlertGuard>();

function emergencyMemberKey(member: unknown): string {
  if (member && typeof member === "object") {
    const record = member as Record<string, unknown>;
    if (typeof record.id === "string" && record.id) return `id:${record.id}`;
    if (typeof record.id === "number" && Number.isFinite(record.id)) return `id:${record.id}`;
    if (typeof record.name === "string" && record.name.trim()) {
      return `name:${record.name.trim().toLowerCase()}`;
    }
  }
  return "bypass";
}

function activeEmergencyGuard(memberKey: string): EmergencyAlertGuard | null {
  const entry = emergencyAlertGuards.get(memberKey);
  if (!entry) return null;
  if (!entry.inFlight && entry.cooldownUntil <= Date.now()) {
    emergencyAlertGuards.delete(memberKey);
    return null;
  }
  return entry;
}

function emergencyGuardRejection(memberKey: string): NextResponse | null {
  const entry = activeEmergencyGuard(memberKey);
  if (!entry) return null;
  if (entry.inFlight) {
    return NextResponse.json({
      ok: false,
      error: "emergency_in_flight",
      message: "An emergency alert is already sending for this member. Wait for it to finish before trying again.",
    }, { status: 409 });
  }
  const retryAfterMs = Math.max(1, entry.cooldownUntil - Date.now());
  return NextResponse.json({
    ok: false,
    error: "emergency_cooldown",
    message: `An emergency alert was sent recently. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`,
    retryAfterMs,
  }, {
    status: 429,
    headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
  });
}

function reserveEmergencyDelivery(memberKey: string): EmergencyAlertGuard | null {
  if (activeEmergencyGuard(memberKey)) return null;
  const entry: EmergencyAlertGuard = {
    inFlight: true,
    cooldownUntil: 0,
    deliveryStarted: false,
  };
  emergencyAlertGuards.set(memberKey, entry);
  return entry;
}

function finishEmergencyDelivery(
  memberKey: string,
  entry: EmergencyAlertGuard,
  deliveryStarted: boolean,
): void {
  if (emergencyAlertGuards.get(memberKey) !== entry) return;
  if (!deliveryStarted) {
    emergencyAlertGuards.delete(memberKey);
    return;
  }
  entry.inFlight = false;
  entry.deliveryStarted = true;
  entry.cooldownUntil = Date.now() + EMERGENCY_ALERT_COOLDOWN_MS;
  emergencyAlertGuards.set(memberKey, entry);
}

export function __resetEmergencyGuardsForTests(): void {
  emergencyAlertGuards.clear();
}

interface EmergencyContact {
  name: string;
  phone: string;
  email: string;
  carrier?: string;
  isPrimary?: boolean;
}

interface HouseAlertResult {
  sent: number;
  failed: number;
  notes: string[];
}

interface NotificationResult {
  contact: string;
  phone: string;
  email: string;
  results: Array<{ method: "SMS" | "Email"; success: boolean; error?: string }>;
  overallSuccess: boolean;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeHouseAlert(value: unknown): HouseAlertResult {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.sent === "number" && Number.isFinite(record.sent) && record.sent >= 0
      && typeof record.failed === "number" && Number.isFinite(record.failed) && record.failed >= 0
      && Array.isArray(record.notes) && record.notes.every((note) => typeof note === "string")
    ) {
      return { sent: record.sent, failed: record.failed, notes: record.notes };
    }
  }
  return { sent: 0, failed: 1, notes: ["House alert result was unavailable."] };
}

function emergencyWarning(
  successful: number,
  total: number,
  houseAlert: HouseAlertResult,
  notificationResults: NotificationResult[],
): string | undefined {
  const warnings: string[] = [];
  if (successful === 0 && houseAlert.sent > 0) {
    warnings.push("House channels delivered, but no primary contact confirmed SMS or email.");
  } else if (successful < total) {
    warnings.push(`${total - successful} primary ${total - successful === 1 ? "contact" : "contacts"} did not confirm a delivery.`);
  }
  if (notificationResults.some((result) => result.results.some((channel) => !channel.success))) {
    warnings.push("One or more contact channels failed.");
  }
  if (houseAlert.sent === 0) {
    warnings.push("No house channel confirmed delivery.");
  } else if (houseAlert.failed > 0) {
    warnings.push(`${houseAlert.failed} house ${houseAlert.failed === 1 ? "channel" : "channels"} failed.`);
  }
  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

function emergencyDetails(
  primaryContacts: EmergencyContact[],
  notificationResults: NotificationResult[],
  houseAlert: HouseAlertResult,
  contactsSource: "live" | "cache",
) {
  const successful = notificationResults.filter((result) => result.overallSuccess).length;
  const partial = successful < primaryContacts.length
    || notificationResults.some((result) => result.results.some((channel) => !channel.success))
    || houseAlert.sent === 0
    || houseAlert.failed > 0;
  const warning = emergencyWarning(successful, primaryContacts.length, houseAlert, notificationResults);
  return {
    total: primaryContacts.length,
    successful,
    failed: primaryContacts.length - successful,
    partial,
    ...(warning ? { warning } : {}),
    contactsSource,
    results: notificationResults,
    houseAlert,
  };
}

function unconfiguredDetails(
  primaryContacts: EmergencyContact[],
  houseAlert: HouseAlertResult,
  contactsSource: "live" | "cache",
) {
  return {
    total: primaryContacts.length,
    successful: 0,
    failed: primaryContacts.length,
    partial: true,
    contactsSource,
    results: primaryContacts.map((contact) => ({
      contact: contact.name,
      phone: contact.phone,
      email: contact.email,
      results: [],
      overallSuccess: false,
    })),
    houseAlert,
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const { type, timestamp, pin } = body as { type?: unknown; timestamp?: unknown; pin?: unknown };
  const validTypes = new Set(["fire", "water", "injury", "general"]);
  if (typeof type !== "string" || !validTypes.has(type)) {
    return NextResponse.json({ ok: false, error: "Emergency type is required or invalid" }, { status: 400 });
  }

  const providedPin = pin || request.headers.get(EMERGENCY_PIN_HEADER);
  if (!providedPin) {
    return NextResponse.json({ ok: false, error: "PIN required to trigger emergency alert" }, { status: 401 });
  }

  let verifiedMember: unknown;
  try {
    verifiedMember = await verifyPinAgainstAnyMember(String(providedPin));
  } catch {
    return NextResponse.json({ ok: false, error: "pin_check_failed" }, { status: 503 });
  }
  if (!verifiedMember && String(providedPin) !== emergencyPinBypass()) {
    return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
  }

  let contacts: EmergencyContact[];
  try {
    const live = await liveEmergencyContacts();
    if (!Array.isArray(live)) {
      return NextResponse.json({
        ok: false,
        error: "contacts_unavailable",
        message: "Live emergency contacts are unavailable. No emergency alert was sent.",
      }, { status: 503 });
    }
    contacts = live;
  } catch {
    return NextResponse.json({
      ok: false,
      error: "contacts_unavailable",
      message: "Live emergency contacts are unavailable. No emergency alert was sent.",
    }, { status: 503 });
  }
  const contactsSource = "live" as const;
  const primaryContacts = contacts.filter((contact) => Boolean(contact?.isPrimary));
  if (primaryContacts.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "No emergency contacts configured. Please set up emergency contacts in settings.",
      contactsSource,
    }, { status: 500 });
  }

  const emergencyMessages = {
    fire: "🔥 FIRE EMERGENCY - Kids need immediate help at home!",
    water: "💧 WATER LEAK EMERGENCY - Immediate attention needed!",
    injury: "🤕 INJURY EMERGENCY - Child injured, need help!",
    general: "🚨 GENERAL EMERGENCY - Kids need assistance!",
  };
  const alertTimestamp = typeof timestamp === "string" || typeof timestamp === "number"
    ? new Date(timestamp)
    : new Date();
  const message = `${emergencyMessages[type as keyof typeof emergencyMessages]} Time: ${alertTimestamp.toLocaleString()}`;

  const memberKey = emergencyMemberKey(verifiedMember);
  const rejectedByGuard = emergencyGuardRejection(memberKey);
  if (rejectedByGuard) return rejectedByGuard;
  const deliveryGuard = reserveEmergencyDelivery(memberKey);
  if (!deliveryGuard) return emergencyGuardRejection(memberKey)!;

  let deliveryConfirmed = false;
  try {
    let houseAlert: HouseAlertResult;
    try {
      houseAlert = normalizeHouseAlert(await broadcastHouseAlert(
        `🚨 EMERGENCY - ${type.toUpperCase()}`,
        message,
      ));
    } catch (error) {
      houseAlert = normalizeHouseAlert(null);
      houseAlert.notes = [errorText(error, "House alert failed.")];
    }
    deliveryConfirmed = houseAlert.sent > 0;

    let credentials: { user: string | null; pass: string | null } | null = null;
  let configError = "config_resolution_failed";
  try {
    credentials = await resolveGmailCredentials();
    if (
      !credentials
      || typeof credentials !== "object"
      || (credentials.user !== null && typeof credentials.user !== "string")
      || (credentials.pass !== null && typeof credentials.pass !== "string")
    ) {
      credentials = null;
    } else if (!credentials.user || !credentials.pass) {
      configError = "service_not_configured";
      credentials = null;
    }
  } catch {
    credentials = null;
  }

  if (!credentials) {
    const details = unconfiguredDetails(primaryContacts, houseAlert, contactsSource);
    const warning = "SMS/email configuration is unavailable. House channel details are preserved below.";
    if (houseAlert.sent > 0) {
      return NextResponse.json({
        ok: true,
        success: true,
        partial: true,
        message: "House channels delivered, but SMS/email are unavailable.",
        warning,
        contactsSource,
        houseAlert,
        details: { ...details, warning },
      });
    }
    return NextResponse.json({
      ok: false,
      error: configError,
      message: "Emergency notification service is unavailable.",
      warning,
      contactsSource,
      houseAlert,
      details: { ...details, warning },
    }, { status: 503 });
  }

  const notificationResults = await Promise.all(primaryContacts.map(async (contact): Promise<NotificationResult> => {
    const results: NotificationResult["results"] = [];
    try {
      const result = await sendSMSViaEmail(
        contact.phone,
        `${message}\nFrom: ${contact.name}`,
        contact.carrier as any,
      );
      results.push({ method: "SMS", success: result?.success === true, error: result?.error });
    } catch (error) {
      results.push({ method: "SMS", success: false, error: errorText(error, "Unknown error") });
    }
    try {
      const result = await sendEmailAlert(
        contact.email,
        `🚨 EMERGENCY ALERT - ${type.toUpperCase()}`,
        `${message}\n\nContact: ${contact.name}\nPhone: ${contact.phone}\n\nThis is an automated emergency notification from Consuela.`,
      );
      results.push({ method: "Email", success: result?.success === true, error: result?.error });
    } catch (error) {
      results.push({ method: "Email", success: false, error: errorText(error, "Unknown error") });
    }
    return {
      contact: contact.name,
      phone: contact.phone,
      email: contact.email,
      results,
      overallSuccess: results.some((result) => result.success),
    };
  }));

  const details = emergencyDetails(primaryContacts, notificationResults, houseAlert, contactsSource);
  deliveryConfirmed = deliveryConfirmed || details.successful > 0;
  const anyDelivered = details.successful > 0 || houseAlert.sent > 0;
  if (!anyDelivered) {
    return NextResponse.json({
      ok: false,
      success: false,
      error: "delivery_failed",
      partial: true,
      message: "No emergency channel confirmed delivery.",
      warning: details.warning,
      contactsSource,
      houseAlert,
      details,
    }, { status: 502 });
  }

  const messageResult = details.partial
    ? details.successful === 0 && houseAlert.sent > 0
      ? "House channels delivered, but no primary contact confirmed SMS or email."
      : "Emergency alert partially delivered. Check the delivery details."
    : `Emergency alert sent to ${details.successful} contact${details.successful === 1 ? "" : "s"} via SMS and/or email`;

    return NextResponse.json({
      ok: true,
      success: true,
      partial: details.partial,
      ...(details.warning ? { warning: details.warning } : {}),
      message: messageResult,
      contactsSource,
      houseAlert,
      details,
    });
  } finally {
    finishEmergencyDelivery(memberKey, deliveryGuard, deliveryConfirmed);
  }
}
