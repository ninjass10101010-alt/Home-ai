import { NextResponse } from "next/server";
import { db } from "@/db";
import { db as pbDb } from "@/db/pb-db";

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
    let contacts = db.selectEmergencyContacts();
    if (!contacts || contacts.length === 0) {
      contacts = await pbDb.selectEmergencyContacts();
    }
    return NextResponse.json({
      contacts: (contacts || []).map(sanitizeContact),
    });
  } catch (error) {
    console.error("Emergency contacts API error:", error);
    return NextResponse.json({ contacts: [] }, { status: 500 });
  }
}
