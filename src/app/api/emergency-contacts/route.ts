import { NextResponse } from "next/server";
import { db } from "@/db";
import { liveEmergencyContacts } from "@/lib/consuela/live-reads";

export const dynamic = "force-dynamic";

function sanitizeContact(contact: any, index: number) {
  return {
    id: contact.id ?? index + 1,
    name: contact.name || "",
    phone: contact.phone || "",
    email: contact.email || "",
    carrier: contact.carrier || undefined,
    relationship: contact.relationship || contact.type || "other",
    isPrimary: Boolean(contact.isPrimary),
    emoji: contact.emoji || undefined,
  };
}

export async function GET() {
  try {
    // Read live from PocketBase (F1): the process-start cache missed contacts
    // added/corrected/removed after container start. Fall back to the cache
    // only when the live read fails, and tell the caller which source answered.
    const live = await liveEmergencyContacts();
    const contacts = live ?? db.selectEmergencyContacts();
    const contactsSource = live === null ? "cache" : "live";
    return NextResponse.json({
      contacts: (contacts || []).map(sanitizeContact),
      contactsSource,
    });
  } catch (error) {
    console.error("Emergency contacts API error:", error);
    return NextResponse.json({ contacts: [], contactsSource: "cache" }, { status: 500 });
  }
}
