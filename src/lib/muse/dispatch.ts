import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/muse/auth";
import { executeMuseTool, scrubInternal } from "@/lib/muse/execute";
import { writeMuseLog } from "@/lib/muse/log";
import { readMuseRow } from "@/lib/muse/store";
import { isCredentialKey } from "@/lib/db-gateway";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_PREVIEW_CHARS = 200;
export const MAX_PREVIEW_DEPTH = 4;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively redact credential-shaped keys at ANY depth (the gateway's
 * credential-key matcher). Cycles are broken with "[cycle]" and nesting past
 * `MAX_PREVIEW_DEPTH` is replaced with "[deep]" so a hostile/deep arg tree can
 * never cost more than a bounded walk. The 200-char cap is applied AFTER
 * redaction so a leaked value can never be truncated into the preview.
 */
export function redactPreviewValue(
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

export function redactedArgsPreview(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(redactPreviewValue(args, 0, new WeakSet()));
  } catch {
    text = "[unserializable args]";
  }
  return text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) : text;
}

/** PB-free ops visibility for rejections (Task 8 rule: never audit these). */
export function warnReject(reason: string, extra: Record<string, unknown>): void {
  console.warn("[muse/tool] reject", { reason, ...extra });
}

export async function currentKeyPrefix(): Promise<string | undefined> {
  try {
    return (await readMuseRow())?.keyPrefix;
  } catch {
    return undefined;
  }
}

export async function dispatchMuseTool(
  request: NextRequest,
  name: string,
  args: Record<string, unknown>,
  auth: { adm: boolean }
): Promise<NextResponse> {
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
  // A SUCCESS payload is caller-facing too: the admin container/host tools echo
  // service URLs and container names, which must never reach a MUSE caller.
  // Same serialized-form scrub so `result` stays a consumable object.
  let scrubbedSuccess: unknown = resultValue;
  try {
    scrubbedSuccess = JSON.parse(scrubInternal(JSON.stringify(resultValue)));
  } catch {
    scrubbedSuccess = scrubInternal(JSON.stringify(resultValue));
  }
  return NextResponse.json({ ok: true, result: scrubbedSuccess });
}
