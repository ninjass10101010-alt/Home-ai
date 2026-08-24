import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sendSMSViaEmail, sendEmailAlert } from "@/lib/free-communication";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const EMERGENCY_PIN_HEADER = "x-emergency-pin";
// Read lazily (per request) so tests can stub the env var via vi.stubEnv;
// runtime behavior is identical to capturing it at module load.
const emergencyPinBypass = () => process.env.EMERGENCY_PIN_BYPASS || "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, timestamp, pin } = body;

    if (!type) {
      return NextResponse.json({ error: "Emergency type is required" }, { status: 400 });
    }

    // Validate emergency type
    const validTypes = ["fire", "water", "injury", "general"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid emergency type" }, { status: 400 });
    }

    // Require PIN verification for emergency alerts
    const providedPin = pin || request.headers.get(EMERGENCY_PIN_HEADER);
    if (!providedPin) {
      return NextResponse.json({ error: "PIN required to trigger emergency alert" }, { status: 401 });
    }

    // Verify PIN against any family member — server-side against PocketBase
    // (the source of truth), never via the client-side member cache.
    const verifiedMember = await verifyPinAgainstAnyMember(String(providedPin));

    if (!verifiedMember && providedPin !== emergencyPinBypass()) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // Fetch emergency contacts from database
    const contacts = db.selectEmergencyContacts();
    const primaryContacts = contacts.filter(c => c.isPrimary);

    if (primaryContacts.length === 0) {
      console.error("No primary emergency contacts configured");
      return NextResponse.json({
        error: "No emergency contacts configured. Please set up emergency contacts in settings."
      }, { status: 500 });
    }

    const emergencyMessages = {
      fire: "🔥 FIRE EMERGENCY - Kids need immediate help at home!",
      water: "💧 WATER LEAK EMERGENCY - Immediate attention needed!",
      injury: "🤕 INJURY EMERGENCY - Child injured, need help!",
      general: "🚨 GENERAL EMERGENCY - Kids need assistance!",
    };

    const message = `${emergencyMessages[type as keyof typeof emergencyMessages]} Time: ${new Date(timestamp).toLocaleString()}`;

    // House-alert channels (HA companion push + Telegram) fire alongside
    // SMS/email so a carrier or Gmail outage can never silence an alert.
    // Failures are captured as notes — they must not break the request.
    let houseAlert: { sent: number; failed: number; notes: string[] } | null = null;
    try {
      houseAlert = await broadcastHouseAlert(
        `🚨 EMERGENCY - ${type.toUpperCase()}`,
        message
      );
    } catch (notifyError) {
      console.error("House alert broadcast failed:", notifyError);
    }

    // Check if Gmail credentials are configured for free email service
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.error("Gmail credentials not configured for emergency notifications");
      return NextResponse.json({
        error: "Emergency notification service not configured. Please set up Gmail credentials."
      }, { status: 500 });
    }

    // Send notifications to all primary contacts using free services
    const notificationPromises = primaryContacts.map(async (contact) => {
      const results = [];

      // Try SMS via email-to-SMS gateway first (most immediate)
      try {
        const smsResult = await sendSMSViaEmail(
          contact.phone,
          `${message}\nFrom: ${contact.name}`,
          contact.carrier as any
        );
        results.push({ method: 'SMS', ...smsResult });
      } catch (error) {
        console.error(`SMS failed for ${contact.name}:`, error);
        results.push({ method: 'SMS', success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }

      // Always try email as backup (more reliable)
      try {
        const emailResult = await sendEmailAlert(
          contact.email,
          `🚨 EMERGENCY ALERT - ${type.toUpperCase()}`,
          `${message}\n\nContact: ${contact.name}\nPhone: ${contact.phone}\n\nThis is an automated emergency notification from Consuela.`
        );
        results.push({ method: 'Email', ...emailResult });
      } catch (error) {
        console.error(`Email failed for ${contact.name}:`, error);
        results.push({ method: 'Email', success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }

      return {
        contact: contact.name,
        phone: contact.phone,
        email: contact.email,
        results,
        overallSuccess: results.some(r => r.success)
      };
    });

    const notificationResults = await Promise.all(notificationPromises);
    const successfulContacts = notificationResults.filter(r => r.overallSuccess).length;
    const failedContacts = notificationResults.filter(r => !r.overallSuccess).length;

    console.log(`[EMERGENCY ALERT] ${type} - ${timestamp}`);
    console.log(`Total primary contacts: ${primaryContacts.length}, Successful: ${successfulContacts}, Failed: ${failedContacts}`);

    // Log detailed results for debugging
    notificationResults.forEach(result => {
      console.log(`${result.contact}: ${result.results.map(r => `${r.method}-${r.success ? '✓' : '✗'}`).join(', ')}`);
    });

    if (successfulContacts === 0) {
      return NextResponse.json({
        error: "Failed to send emergency alert to any contacts via SMS or email"
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Emergency alert sent to ${successfulContacts} contact${successfulContacts > 1 ? 's' : ''} via SMS and/or email`,
      details: {
        total: primaryContacts.length,
        successful: successfulContacts,
        failed: failedContacts,
        results: notificationResults,
        ...(houseAlert
          ? { houseAlert: { sent: houseAlert.sent, failed: houseAlert.failed, notes: houseAlert.notes } }
          : null),
      }
    });

  } catch (error) {
    console.error("Emergency API error:", error);
    return NextResponse.json({
      error: "Failed to send emergency alert"
    }, { status: 500 });
  }
}
