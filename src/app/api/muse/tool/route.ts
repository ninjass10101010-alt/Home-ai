import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest, clientIp } from "@/lib/muse/auth";
import { executeMuseTool } from "@/lib/muse/execute";
import { writeMuseLog } from "@/lib/muse/log";
import { readMuseRow } from "@/lib/muse/store";
import { isCredentialKey } from "@/lib/db-gateway";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A tool call is a small structured payload; anything larger is rejected
// before parsing so a hostile body cannot be cheaply buffered.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PREVIEW_CHARS = 200;

/**
 * Audit preview: the gateway's credential-key matcher redacts any
 * credential-shaped arg key (pin/secret/password/token …) before the args are
 * stringified. The result is capped at 200 chars. The full args for a
 * credential-shaped key are NEVER logged.
 */
function redactedArgsPreview(args: Record<string, unknown>): string {
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    preview[key] = isCredentialKey(key) ? "[redacted]" : value;
  }
  let text: string;
  try {
    text = JSON.stringify(preview);
  } catch {
    text = "[unserializable args]";
  }
  return text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) : text;
}

async function currentKeyPrefix(): Promise<string | undefined> {
  try {
    return (await readMuseRow())?.keyPrefix;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Size guard: the header when present, then the actual parsed byte length
  // (a chunked body may omit content-length).
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.name !== "string" || body.name.trim() === "") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const name: string = body.name;
  const rawArgs = body.args === undefined ? {} : body.args;
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const args = rawArgs as Record<string, unknown>;

  const startedAt = Date.now();
  const out = await executeMuseTool(name, args, { admin: auth.adm });
  const ms = Date.now() - startedAt;

  await writeMuseLog({
    kind: "tool",
    tool: name,
    ok: !("error" in out),
    ms,
    tokenAdmin: auth.adm,
    keyPrefix: await currentKeyPrefix(),
    ip: clientIp(request),
    detail: redactedArgsPreview(args),
  });

  if ("error" in out) {
    return NextResponse.json({ ok: false, error: out.error }, { status: out.status });
  }
  return NextResponse.json({ ok: true, result: out.result });
}
