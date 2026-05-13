import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, timestamp } = body;

    if (!type) {
      return NextResponse.json({ error: "Emergency type is required" }, { status: 400 });
    }

    const emergencyContacts = [
      { name: "Mom", phone: "(555) 123-4567", email: "mom@example.com" },
      { name: "Dad", phone: "(555) 234-5678", email: "dad@example.com" },
      { name: "Grandma", phone: "(555) 345-6789", email: "grandma@example.com" },
    ];

    const emergencyMessages = {
      fire: "🔥 FIRE EMERGENCY - Kids need help at home!",
      water: "💧 WATER LEAK EMERGENCY - Immediate attention needed!",
      injury: "🤕 INJURY EMERGENCY - Child injured, need help!",
      general: "🚨 GENERAL EMERGENCY - Kids need assistance!",
    };

    const message = `${emergencyMessages[type as keyof typeof emergencyMessages] || "EMERGENCY"} Time: ${timestamp}`;

    console.log(`[EMERGENCY] ${type} - ${timestamp}`);
    console.log(`Contacts to notify: ${emergencyContacts.length}`);

    for (const contact of emergencyContacts) {
      console.log(`Would send to ${contact.name} at ${contact.phone}${contact.email ? ` / ${contact.email}` : ""}`);
    }

    return NextResponse.json({ success: true, message: "Emergency alert sent" });
  } catch (error) {
    console.error("Emergency API error:", error);
    return NextResponse.json({ error: "Failed to send emergency alert" }, { status: 500 });
  }
}