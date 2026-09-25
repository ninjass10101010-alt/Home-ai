import { NextRequest, NextResponse } from "next/server";
import { liveEmergencyContacts } from "@/lib/consuela/live-reads";
import { resolveGmailCredentials, sendSMSViaEmail, sendEmailAlert, TEST_ALERT_SUBJECT } from "@/lib/free-communication";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { authorizeCurrentParentRequest, verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const TEST_ALERT_COPY = TEST_ALERT_SUBJECT;

interface TestContact {
  name: string;
  phone: string;
  email: string;
  carrier?: string;
  isPrimary?: boolean;
}

interface ChannelResult {
  method: "SMS" | "Email";
  success: boolean;
  error?: string;
}

interface ContactResult {
  contact: string;
  phone: string;
  email: string;
  results: ChannelResult[];
  overallSuccess: boolean;
}

interface HouseAlertResult {
  sent: number;
  failed: number;
  notes: string[];
}

interface DeliveryDetails {
  total: number;
  successful: number;
  failed: number;
  partial: boolean;
  warning?: string;
  contactsSource: "live" | "cache";
  results: ContactResult[];
  channelResults: Array<ChannelResult & { contact: string }>;
  channels: Array<{ method: "SMS" | "Email"; total: number; successful: number; failed: number; results: Array<ChannelResult & { contact: string }> }>;
  houseAlert: HouseAlertResult | null;
  house: HouseAlertResult | null;
}

export const EMERGENCY_TEST_COOLDOWN_MS = 30_000;

interface EmergencyTestGuard {
  inFlight: boolean;
  cooldownUntil: number;
}

const emergencyTestGuards = new Map<string, EmergencyTestGuard>();

function activeGuard(parentId: string): EmergencyTestGuard | null {
  const entry = emergencyTestGuards.get(parentId);
  if (!entry) return null;
  if (!entry.inFlight && entry.cooldownUntil <= Date.now()) {
    emergencyTestGuards.delete(parentId);
    return null;
  }
  return entry;
}

function guardRejection(parentId: string): NextResponse | null {
  const entry = activeGuard(parentId);
  if (!entry) return null;
  if (entry.inFlight) {
    return NextResponse.json({
      ok: false,
      error: "test_alert_in_flight",
      message: "A real test alert is already sending. Wait for it to finish before trying again.",
    }, { status: 409 });
  }
  const retryAfterMs = Math.max(1, entry.cooldownUntil - Date.now());
  return NextResponse.json({
    ok: false,
    error: "test_alert_cooldown",
    message: `A real test alert was sent recently. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before trying again.`,
    retryAfterMs,
  }, {
    status: 429,
    headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
  });
}

function reserveDelivery(parentId: string): EmergencyTestGuard | null {
  if (activeGuard(parentId)) return null;
  const entry = { inFlight: true, cooldownUntil: 0 };
  emergencyTestGuards.set(parentId, entry);
  return entry;
}

function finishDelivery(parentId: string, entry: EmergencyTestGuard, deliveryConfirmed: boolean): void {
  if (emergencyTestGuards.get(parentId) !== entry) return;
  if (!deliveryConfirmed) {
    emergencyTestGuards.delete(parentId);
    return;
  }
  entry.inFlight = false;
  entry.cooldownUntil = Date.now() + EMERGENCY_TEST_COOLDOWN_MS;
  emergencyTestGuards.set(parentId, entry);
}

export function __resetEmergencyTestGuardsForTests(): void {
  emergencyTestGuards.clear();
}

function isFourDigitPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
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

function buildDetails(
  contacts: TestContact[],
  results: ContactResult[],
  houseAlert: HouseAlertResult | null,
  contactsSource: "live" | "cache",
  warning?: string,
): DeliveryDetails {
  const channelResults = results.flatMap((result) => resultsForContact(result));
  const successful = results.filter((result) => result.overallSuccess).length;
  const failed = results.length - successful;
  const partial = successful < results.length
    || channelResults.some((result) => !result.success)
    || !houseAlert
    || houseAlert.sent === 0
    || houseAlert.failed > 0;
  const channels = (["SMS", "Email"] as const).map((method) => {
    const entries = channelResults.filter((result) => result.method === method);
    return {
      method,
      total: entries.length,
      successful: entries.filter((result) => result.success).length,
      failed: entries.filter((result) => !result.success).length,
      results: entries,
    };
  });
  return {
    total: contacts.length,
    successful,
    failed,
    partial,
    ...(warning ? { warning } : {}),
    contactsSource,
    results,
    channelResults,
    channels,
    houseAlert,
    house: houseAlert,
  };
}

function resultsForContact(result: ContactResult): Array<ChannelResult & { contact: string }> {
  return result.results.map((channel) => ({ contact: result.contact, ...channel }));
}

function deliveryWarning(details: DeliveryDetails): string | undefined {
  const warnings: string[] = [];
  if (details.successful === 0 && details.houseAlert && details.houseAlert.sent > 0) {
    warnings.push("House channels delivered, but no primary contact confirmed SMS or email. Retry may duplicate house delivery.");
  } else if (details.failed > 0) {
    warnings.push(`${details.failed} primary ${details.failed === 1 ? "contact" : "contacts"} did not confirm a delivery.`);
  }
  if (details.channelResults.some((result) => !result.success)) {
    warnings.push("One or more contact channels failed.");
  }
  if (!details.houseAlert || details.houseAlert.sent === 0) {
    warnings.push("No house channel confirmed delivery.");
  } else if (details.houseAlert.failed > 0) {
    warnings.push(`${details.houseAlert.failed} house ${details.houseAlert.failed === 1 ? "channel" : "channels"} failed.`);
  }
  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

export async function POST(request: NextRequest) {
  const parentAuth = await authorizeCurrentParentRequest(request);
  if (!parentAuth.ok) {
    return NextResponse.json({ ok: false, error: parentAuth.error }, { status: parentAuth.status });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const body = parsed as { pin?: unknown };
  if (!isFourDigitPin(body.pin)) {
    return NextResponse.json({ ok: false, error: "PIN must be exactly four digits" }, { status: 400 });
  }

  let verifiedMember: unknown;
  try {
    verifiedMember = await verifyPinAgainstAnyMember(body.pin);
  } catch {
    return NextResponse.json({ ok: false, error: "pin_check_failed" }, { status: 503 });
  }
  if (!verifiedMember) {
    return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
  }

  const parentId = parentAuth.session?.memberId || parentAuth.member?.id || "unknown-parent";
  const rejectedByGuard = guardRejection(parentId);
  if (rejectedByGuard) return rejectedByGuard;

  let live: unknown;
  try {
    live = await liveEmergencyContacts();
  } catch {
    live = null;
  }
  if (!Array.isArray(live)) {
    return NextResponse.json({
      ok: false,
      error: "contacts_unavailable",
      message: "Live emergency contacts are unavailable. No test alert was sent. Try again after PocketBase is available.",
    }, { status: 503 });
  }
  const contacts = live as TestContact[];
  const primaryContacts = contacts.filter((contact) => Boolean(contact?.isPrimary));
  if (primaryContacts.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "no_primary_contacts",
      contactsSource: "live",
    }, { status: 422 });
  }

  let credentials: { user: string | null; pass: string | null };
  try {
    credentials = await resolveGmailCredentials();
  } catch {
    return NextResponse.json({ ok: false, error: "config_resolution_failed" }, { status: 503 });
  }
  if (!credentials || typeof credentials !== "object" || (credentials.user !== null && typeof credentials.user !== "string") || (credentials.pass !== null && typeof credentials.pass !== "string")) {
    return NextResponse.json({ ok: false, error: "config_resolution_failed" }, { status: 503 });
  }
  if (!credentials.user || !credentials.pass) {
    return NextResponse.json({ ok: false, error: "service_not_configured" }, { status: 503 });
  }

  const deliveryGuard = reserveDelivery(parentId);
  if (!deliveryGuard) return guardRejection(parentId)!;
  let deliveryConfirmed = false;

  try {
    const sentAt = new Date().toISOString();
    const message = `${TEST_ALERT_COPY} This is a test of the configured SMS, email, and house channels. Time: ${sentAt}`;
    let houseAlert: HouseAlertResult;
    try {
      houseAlert = normalizeHouseAlert(await broadcastHouseAlert(TEST_ALERT_COPY, message));
    } catch (error) {
      houseAlert = { sent: 0, failed: 1, notes: [errorText(error, "House alert failed.")] };
    }

    deliveryConfirmed = houseAlert.sent > 0;

    const notificationResults: ContactResult[] = await Promise.all(primaryContacts.map(async (contact) => {
      const results: ChannelResult[] = [];
      try {
        const result = await sendSMSViaEmail(
          contact.phone,
          `${message}\nFrom: ${contact.name}`,
          contact.carrier as any,
          { testOnly: true, subject: TEST_ALERT_COPY },
        );
        results.push({ method: "SMS", success: result?.success === true, error: result?.error });
      } catch (error) {
        results.push({ method: "SMS", success: false, error: errorText(error, "Unknown error") });
      }
      try {
        const result = await sendEmailAlert(
          contact.email,
          TEST_ALERT_COPY,
          `${message}\n\nContact: ${contact.name}\nPhone: ${contact.phone}\n\nThis is a test alert; no emergency is active.`,
          { testOnly: true },
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

    deliveryConfirmed = deliveryConfirmed || notificationResults.some((result) => result.overallSuccess);

    let details = buildDetails(primaryContacts, notificationResults, houseAlert, "live");
    const warning = deliveryWarning(details);
    details = { ...details, ...(warning ? { warning } : {}) };
    const anyDelivered = details.successful > 0 || (details.houseAlert?.sent ?? 0) > 0;
    if (!anyDelivered) {
      return NextResponse.json({
        ok: false,
        success: false,
        error: "delivery_failed",
        partial: true,
        warning,
        contactsSource: "live",
        houseAlert,
        details,
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      success: true,
      partial: details.partial,
      ...(warning ? { warning } : {}),
      message: details.partial
        ? "Test alert partially delivered. Check the delivery details before retrying."
        : "Test alert sent through the configured channels.",
      contactsSource: "live",
      houseAlert,
      details,
    });
  } finally {
    finishDelivery(parentId, deliveryGuard, deliveryConfirmed);
  }
}
