import { NextResponse } from "next/server";

// Placeholder API route for Google Calendar OAuth & sync
// Extend this with real googleapis OAuth2 flow + calendar.events.list
export async function GET() {
  return NextResponse.json({ status: "ok", message: "Google Calendar mock endpoint. Use for OAuth redirect or sync trigger." });
}

export async function POST(req: Request) {
  const body = await req.json();
  // Mock sync response
  return NextResponse.json({ 
    synced: true, 
    events: body.events || ["Sample event 1", "Sample event 2"],
    note: "Extend with real Google Calendar API + PocketBase insert here"
  });
}
