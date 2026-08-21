import { NextResponse } from "next/server";
import { fetchHADeviceStates } from "@/lib/ha/rest-client";

export async function POST() {
  try {
    const states = await fetchHADeviceStates();
    return NextResponse.json({ success: true, count: states.length, states });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
