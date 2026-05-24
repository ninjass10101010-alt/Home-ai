import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const FAMILY_PATH = process.env.FAMILY_DATA_PATH || path.join(process.cwd(), "family.json");

export async function GET() {
  try {
    if (!fs.existsSync(FAMILY_PATH)) {
      const defaultMembers = [
        { id: "1", name: "Rebecca (Mom)", role: "Parent", emoji: "👩", color: "green", age: "38", joined: "Feb 2024" },
        { id: "2", name: "Jeffery (Dad)", role: "Parent", emoji: "👨", color: "cyan", age: "40", joined: "Feb 2024" },
        { id: "3", name: "Emily", role: "Child", emoji: "👧", color: "violet", age: "14", joined: "Mar 2024" },
        { id: "4", name: "Bailey", role: "Child", emoji: "👧", color: "amber", age: "12", joined: "Mar 2024" },
        { id: "5", name: "Jasmine", role: "Child", emoji: "👧", color: "rose", age: "10", joined: "Mar 2024" },
        { id: "6", name: "Aurora", role: "Child", emoji: "👧", color: "blue", age: "7", joined: "Mar 2024" },
        { id: "7", name: "Caspian", role: "Child", emoji: "🧒", color: "violet", age: "5", joined: "Mar 2024" },
        { id: "8", name: "Rocco", role: "Pet", emoji: "🐶", color: "amber", age: "3", joined: "Feb 2024" },
        { id: "9", name: "Rico", role: "Pet", emoji: "🐩", color: "cyan", age: "5", joined: "Feb 2024" }
      ];
      fs.writeFileSync(FAMILY_PATH, JSON.stringify(defaultMembers, null, 2));
      return NextResponse.json(defaultMembers);
    }
    const raw = fs.readFileSync(FAMILY_PATH, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: "Failed to read family data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    fs.writeFileSync(FAMILY_PATH, JSON.stringify(data, null, 2));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to write family data" }, { status: 500 });
  }
}
