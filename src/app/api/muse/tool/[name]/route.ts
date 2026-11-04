import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest, clientIp } from "@/lib/muse/auth";
import {
  dispatchMuseTool,
  warnReject,
  isPlainObject,
  MAX_BODY_BYTES,
} from "@/lib/muse/dispatch";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ name: string }> | { name: string };
};

async function resolveName(context: RouteContext): Promise<string> {
  const p = await context.params;
  return typeof p?.name === "string" ? p.name.trim() : "";
}

/**
 * Individual tool routing (POST /api/muse/tool/{name}).
 *
 * Dedicated OpenAPI/Agent endpoint: executes a single tool where the tool name
 * is in the path and the tool arguments are sent directly as the request body.
 * Also tolerates `{ args: { ... } }` or an empty body (for zero-arg tools).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    warnReject("auth_failed", { status: auth.status, error: auth.error, ip: clientIp(request) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const name = await resolveName(context);
  if (!name) {
    warnReject("invalid_body", { ip: clientIp(request), reason: "missing_tool_name" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Size guard
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    warnReject("payload_too_large", { ip: clientIp(request), declared });
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

  let text = "";
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

  let args: Record<string, unknown> = {};
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    let body: any;
    try {
      body = JSON.parse(trimmed);
    } catch {
      warnReject("invalid_body", { ip: clientIp(request), reason: "parse_failed" });
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      warnReject("invalid_body", { ip: clientIp(request), reason: "bad_args" });
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    // Unwrap if client sent `{ args: { ... } }`
    if (isPlainObject(body.args) && Object.keys(body).length === 1) {
      args = body.args as Record<string, unknown>;
    } else {
      args = body as Record<string, unknown>;
    }
  }

  return dispatchMuseTool(request, name, args, auth);
}

/**
 * Convenience GET handler for read-only tools where query parameters become
 * the tool arguments.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    warnReject("auth_failed", { status: auth.status, error: auth.error, ip: clientIp(request) });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const name = await resolveName(context);
  if (!name) {
    warnReject("invalid_body", { ip: clientIp(request), reason: "missing_tool_name" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const args: Record<string, unknown> = {};
  for (const [key, val] of request.nextUrl.searchParams.entries()) {
    args[key] = val;
  }

  return dispatchMuseTool(request, name, args, auth);
}
