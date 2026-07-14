import { NextResponse } from "next/server";

/**
 * Google Calendar API route — reads events from PocketBase `events` collection.
 * 
 * Flow: Hermes sync script pulls from Google Calendar via Composio
 *       → writes to PB `events` collection  
 *       → this route reads PB and returns them to the dashboard.
 * 
 * GET /api/google-calendar?type=event|task
 */

const PB_URL = process.env.PB_URL || process.env.POCKETBASE_URL || "http://pocketbase:8090";

async function pbAuth(): Promise<string> {
  const res = await fetch(PB_URL + "/api/collections/_superusers/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL || "admin@family.local",
      password: process.env.PB_ADMIN_PASSWORD || "",
    }),
  });
  if (!res.ok) throw new Error("PB auth failed: " + res.status);
  const data = await res.json();
  return data.token;
}

async function pbQuery(collection: string, token: string, filter?: string) {
  const params = new URLSearchParams({ perPage: "200", sort: "-date" });
  if (filter) params.set("filter", filter);
  
  const res = await fetch(PB_URL + "/api/collections/" + collection + "/records?" + params.toString(), {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!res.ok) throw new Error("PB query failed: " + res.status);
  return res.json();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "event";

    const token = await pbAuth();
    const filter = type === "task" ? 'type="task"' : 'type!="task"';
    const data = await pbQuery("events", token, filter);
    const items = data.items || [];

    const events = items.map((item: any) => ({
      id: item.id,
      title: item.title,
      date: item.date,
      time: item.time || "All day",
      description: item.notes || "",
      type: item.type || "event",
      member: item.member || "Google",
    }));

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error("[Google Calendar API]", error.message);
    
    // Fallback: read from static JSON if PB unreachable
    try {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const { existsSync } = await import("fs");
      
      const type = new URL(request.url).searchParams.get("type") || "event";
      const fileName = type === "task" ? "google-tasks.json" : "google-events.json";
      const filePath = pathMod.join(process.cwd(), "public", fileName);
      
      if (existsSync(filePath)) {
        const raw = await fs.readFile(filePath, "utf-8");
        return NextResponse.json({ events: JSON.parse(raw), source: "fallback" });
      }
    } catch {}
    
    return NextResponse.json({ events: [], error: "Failed to fetch events" });
  }
}
