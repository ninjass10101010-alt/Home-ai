import { NextRequest, NextResponse } from "next/server";
import { haTranscribe } from "@/lib/ha/voice";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let audioBuffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("audio");
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { ok: false, error: 'Missing "audio" file in form-data' },
          { status: 400 }
        );
      }
      const arrayBuffer = await (file as Blob).arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    } else {
      // Direct binary payload
      const arrayBuffer = await request.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    }

    if (audioBuffer.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Empty audio payload" },
        { status: 400 }
      );
    }

    const { text } = await haTranscribe(audioBuffer);
    return NextResponse.json({
      ok: true,
      text,
    });
  } catch (error: any) {
    console.error("[api/voice/transcribe] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
