import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest, clientIp } from "@/lib/muse/auth";
import { executeMuseTool, scrubInternal } from "@/lib/muse/execute";
import { writeMuseLog } from "@/lib/muse/log";
import { readMuseRow } from "@/lib/muse/store";
import { isCredentialKey } from "@/lib/db-gateway";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A tool call is a small structured payload. When the client sends a
// Content-Length header an oversized body is rejected before we read it; since
// a chunked body may omit Content-Length, the parsed byte length is ALSO
// checked after the read (so an oversized chunked body can still buffer up to
// that point before it is rejected).
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PREVIEW_CHARS = 200;
const MAX_PREVIEW_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively redact credential-shaped keys at ANY depth (the gateway's
 * credential-key matcher). Cycles are broken with "[cycle]" and nesting past
 * `MAX_PREVIEW_DEPTH` is replaced with "[deep]" so a hostile/deep arg tree can
 * never cost more than a bounded walk. The 200-char cap is applied AFTER
 * redaction so a leaked value can never be truncated into the preview.
 */
function redactPreviewValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > MAX_PREVIEW_DEPTH) return "[deep]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[cycle]";
    seen.add(value);
    return value.map((item) => redactPreviewValue(item, depth + 1, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return "[cycle]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isCredentialKey(key) ? "[redacted]" : redactPreviewValue(val, depth + 1, seen);
    }
    return out;
  }
  return value;
}

function redactedArgsPreview(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(redactPreviewValue(args, 0, new WeakSet()));
  } catch {
    text = "[unserializable args]";
  }
  return text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) : text;
}

/** PB-free ops visibility for rejections (Task 8 rule: never audit these). */
function warnReject(reason: string, extra: Record<string, unknown>): void {
  console.warn("[muse/tool] reject", { reason, ...extra });
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

  const startedAt = Date.now();
  const out = await executeMuseTool(name, args, { admin: auth.adm });
  const ms = Date.now() - startedAt;

  // The audit `ok` must be TRUE only when the executor really succeeded. A
  // self-reporting handler can return a parsed object carrying `error` or
  // `ok:false` — that is a failed tool call even though no exception escaped.
  const resultValue = "result" in out ? out.result : undefined;
  const selfReportedError =
    isPlainObject(resultValue) &&
    (typeof resultValue.error === "string" || resultValue.ok === false);
  const ok = !("error" in out) && !selfReportedError;

  // Audit detail stays the redacted args ONLY — never the error text.
  await writeMuseLog({
    kind: "tool",
    tool: name,
    ok,
    ms,
    tokenAdmin: auth.adm,
    keyPrefix: await currentKeyPrefix(),
    ip: clientIp(request),
    detail: redactedArgsPreview(args),
  });

  if ("error" in out) {
    return NextResponse.json({ ok: false, error: scrubInternal(out.error) }, { status: out.status });
  }
  if (isPlainObject(resultValue) && typeof resultValue.error === "string") {
    return NextResponse.json({ ok: false, error: scrubInternal(resultValue.error) }, { status: 200 });
  }
  if (isPlainObject(resultValue) && resultValue.ok === false) {
    // A self-reported `{ok:false, result:{…}}` still carries handler output to
    // the caller, so it gets the same internal-host scrub as every other
    // caller-facing payload. Scrubbing the serialized form keeps the JSON shape
    // a caller can consume (`result` stays an object) rather than flattening it
    // to a string.
    let scrubbedResult: unknown = resultValue;
    try {
      scrubbedResult = JSON.parse(scrubInternal(JSON.stringify(resultValue)));
    } catch {
      scrubbedResult = scrubInternal(JSON.stringify(resultValue));
    }
    return NextResponse.json({ ok: false, result: scrubbedResult }, { status: 200 });
  }
  return NextResponse.json({ ok: true, result: resultValue });
}
