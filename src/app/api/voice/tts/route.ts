import { NextRequest, NextResponse } from "next/server";
import { haSynthesize } from "@/lib/ha/voice";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = body?.message;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { ok: false, error: 'Missing "message" in request body' },
        { status: 400 }
      );
    }

    const { url, path } = await haSynthesize(message);
    return NextResponse.json({
      ok: true,
      url,
      path,
    });
  } catch (error: any) {
    console.error("[api/voice/tts] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to synthesize speech" },
      { status: 500 }
    );
  }
}
