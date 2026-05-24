import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "public", "google-events.json");
    if (!existsSync(filePath)) {
      return NextResponse.json({ events: [] });
    }
    const data = await readFile(filePath, "utf-8");
    const events = JSON.parse(data);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [], error: "Failed to read Google Calendar events" });
  }
}
