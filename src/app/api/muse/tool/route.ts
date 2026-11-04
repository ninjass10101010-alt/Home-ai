import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest, clientIp } from "@/lib/muse/auth";
import {
  dispatchMuseTool,
  warnReject,
  MAX_BODY_BYTES,
} from "@/lib/muse/dispatch";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    // Auth-time 401/403 emit no audit (Task 8 rule) — console only so ops can
    // still see them.
    warnReject("auth_failed", { status: auth.status, error: auth.error, ip: clientIp(request) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Size guard: the header when present, then the actual parsed byte length
  // (a chunked body may omit content-length).
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    warnReject("payload_too_large", { ip: clientIp(request), declared });
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    warnReject("invalid_body", { ip: clientIp(request), reason: "read_failed" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    warnReject("payload_too_large", { ip: clientIp(request), bytes: text.length });
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    warnReject("invalid_body", { ip: clientIp(request), reason: "parse_failed" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.name !== "string" || body.name.trim() === "") {
    warnReject("invalid_body", { ip: clientIp(request), reason: "bad_shape" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const name: string = body.name;
  const rawArgs = body.args === undefined ? {} : body.args;
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    warnReject("invalid_body", { ip: clientIp(request), reason: "bad_args" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const args = rawArgs as Record<string, unknown>;

  return dispatchMuseTool(request, name, args, auth);
}
