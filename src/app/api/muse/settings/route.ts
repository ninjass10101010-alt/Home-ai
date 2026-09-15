import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { readMuseRow, ensureMuseRow, updateMuseSettings, type MuseRow } from "@/lib/muse/store";

// Operators configure the MUSE identity from the dashboard. Every handler is
// gated on the parent allowlist (authorizeAdminRequest): guests 401, child/pet
// 403 adult_only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RATE = 120;

function view(row: MuseRow) {
  return {
    ok: true as const,
    enabled: row.enabled,
    adminEnabled: row.adminEnabled,
    keyPrefix: row.keyPrefix,
    version: row.version,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    rateLimitPerMin: row.rateLimitPerMin,
    // `hasKey` means "a usable key has been generated", not merely "the
    // singleton row exists": the row is created disabled + unkeyed by
    // ensureMuseRow() the first time any settings/login path touches it. A row
    // with an empty keyHash is honest as hasKey:false (the Settings card then
    // offers "Generate key" instead of a misleading empty prefix).
    hasKey: !!row.keyHash,
  };
}

function denied(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function invalidBody() {
  return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
}

export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return denied(auth.status ?? 401, auth.error ?? "unauthorized");

  const row = await readMuseRow();
  if (!row) {
    // Default envelope so the settings card renders before any key exists.
    return NextResponse.json({
      ok: true,
      enabled: false,
      adminEnabled: false,
      keyPrefix: null,
      version: 0,
      createdAt: null,
      rotatedAt: null,
      lastUsedAt: null,
      rateLimitPerMin: DEFAULT_RATE,
      hasKey: false,
    });
  }
  return NextResponse.json(view(row));
}

export async function PUT(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return denied(auth.status ?? 401, auth.error ?? "unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidBody();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidBody();

  const b = body as Record<string, unknown>;
  const patch: { enabled?: boolean; adminEnabled?: boolean; rateLimitPerMin?: number } = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return invalidBody();
    patch.enabled = b.enabled;
  }
  if (b.adminEnabled !== undefined) {
    if (typeof b.adminEnabled !== "boolean") return invalidBody();
    patch.adminEnabled = b.adminEnabled;
  }
  if (b.rateLimitPerMin !== undefined) {
    if (typeof b.rateLimitPerMin !== "number" || !Number.isFinite(b.rateLimitPerMin)) return invalidBody();
    // store.updateMuseSettings clamps into [MIN_RATE, MAX_RATE].
    patch.rateLimitPerMin = b.rateLimitPerMin;
  }

  await ensureMuseRow();
  const updated = await updateMuseSettings(patch);
  return NextResponse.json(view(updated));
}
