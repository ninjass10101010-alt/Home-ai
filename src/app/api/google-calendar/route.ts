import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "event";

    const eventsFile = path.join(process.cwd(), "public", "google-events.json");
    const tasksFile = path.join(process.cwd(), "public", "google-tasks.json");

    let events: any[] = [];

    if (type === "event" && existsSync(eventsFile)) {
      const data = await readFile(eventsFile, "utf-8");
      const parsed = JSON.parse(data);
      events = parsed.filter((e: any) => !type || e.type === type);
    }

    if (type === "task" && existsSync(tasksFile)) {
      const data = await readFile(tasksFile, "utf-8");
      events = JSON.parse(data);
    }

    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [], error: "Failed to read events" });
  }
}