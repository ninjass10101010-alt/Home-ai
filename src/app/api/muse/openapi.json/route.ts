import { NextRequest, NextResponse } from "next/server";
import { generateMuseOpenApi } from "@/lib/muse/openapi";

// Public by design — documents the OpenAPI schema and contains no family data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractBaseUrl(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) {
    const proto = forwardedProto || request.nextUrl.protocol?.replace(":", "") || "http";
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin || "http://nas.local:3000";
}

export async function GET(request: NextRequest) {
  const baseUrl = extractBaseUrl(request);
  const spec = generateMuseOpenApi(baseUrl);
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}
