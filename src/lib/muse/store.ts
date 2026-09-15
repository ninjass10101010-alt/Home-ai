// Server-side persistence for the MUSE inbound identity (Task 8 / B2).
//
// MUSE is a singleton: exactly one active `consuela_muse` row holds the key
// hash, the identity version, the enabled/admin toggles and the rate limit.
// Rotating the key (or revoking tokens) bumps `version`, which invalidates
// every outstanding token (see ./token.ts). The plaintext key is returned to
// the caller exactly once and never stored — only its SHA-256 hash is.

import { createHash, randomBytes } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";

export interface MuseRow {
  id: string;
  label?: string;
  keyHash: string;
  keyPrefix: string;
  version: number;
  enabled: boolean;
  adminEnabled: boolean;
  rateLimitPerMin: number;
  createdAt: string;
  rotatedAt?: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
}

const COLLECTION = "consuela_muse";
const MIN_RATE = 10;
const MAX_RATE = 600;
const DEFAULT_RATE = 120;

export function hashMuseKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function clampRateLimit(value: number): number {
  if (!Number.isFinite(value)) return MIN_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value)));
}

function normalizeMuseRow(record: any): MuseRow {
  return {
    id: record.id,
    label: record.label ?? undefined,
    keyHash: record.keyHash ?? "",
    keyPrefix: record.keyPrefix ?? "",
    version: typeof record.version === "number" ? record.version : 1,
    enabled: record.enabled === true,
    adminEnabled: record.adminEnabled === true,
    rateLimitPerMin:
      typeof record.rateLimitPerMin === "number" ? record.rateLimitPerMin : DEFAULT_RATE,
    createdAt: record.createdAt ?? record.created ?? "",
    rotatedAt: record.rotatedAt ?? undefined,
    lastUsedAt: record.lastUsedAt ?? undefined,
    lastUsedIp: record.lastUsedIp ?? undefined,
  };
}

/** The newest MUSE row, or null when the singleton has not been created yet. */
export async function readMuseRow(): Promise<MuseRow | null> {
  const rows = await withAdmin((pb) =>
    pb.collection(COLLECTION).getFullList({ sort: "-created", requestKey: null })
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return normalizeMuseRow(rows[0]);
}

/** Return the singleton, creating it (disabled, unkeyed) when absent. */
export async function ensureMuseRow(): Promise<MuseRow> {
  const existing = await readMuseRow();
  if (existing) return existing;
  const created = await withAdmin((pb) =>
    pb.collection(COLLECTION).create({
      enabled: false,
      adminEnabled: false,
      version: 1,
      rateLimitPerMin: DEFAULT_RATE,
      createdAt: new Date().toISOString(),
      keyHash: "",
      keyPrefix: "",
    })
  );
  return normalizeMuseRow(created);
}

/** Mint a fresh plaintext key plus its stored forms. Never persisted here. */
export function generateKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = `muse_${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashMuseKey(key), keyPrefix: key.slice(0, 8) };
}

/** Install a new key, bump the version (revoking old tokens), stamp rotation. */
export async function rotateKey(): Promise<{ key: string }> {
  const row = await ensureMuseRow();
  const { key, keyHash, keyPrefix } = generateKey();
  await withAdmin((pb) =>
    pb.collection(COLLECTION).update(row.id, {
      keyHash,
      keyPrefix,
      version: (row.version ?? 1) + 1,
      rotatedAt: new Date().toISOString(),
    })
  );
  return { key };
}

/** Revoke every outstanding token without changing the key. */
export async function revokeTokens(): Promise<void> {
  const row = await ensureMuseRow();
  await withAdmin((pb) =>
    pb.collection(COLLECTION).update(row.id, { version: (row.version ?? 1) + 1 })
  );
}

export async function updateMuseSettings(patch: {
  enabled?: boolean;
  adminEnabled?: boolean;
  rateLimitPerMin?: number;
}): Promise<MuseRow> {
  const row = await ensureMuseRow();
  const update: Record<string, unknown> = {};
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.adminEnabled !== undefined) update.adminEnabled = patch.adminEnabled;
  if (patch.rateLimitPerMin !== undefined) {
    update.rateLimitPerMin = clampRateLimit(patch.rateLimitPerMin);
  }
  const updated = await withAdmin((pb) => pb.collection(COLLECTION).update(row.id, update));
  return normalizeMuseRow(updated);
}

/** Best-effort usage stamp — must never throw into the request path. */
export async function touchMuseUsage(ip: string): Promise<void> {
  try {
    const row = await readMuseRow();
    if (!row) return;
    await withAdmin((pb) =>
      pb.collection(COLLECTION).update(row.id, {
        lastUsedAt: new Date().toISOString(),
        lastUsedIp: ip,
      })
    );
  } catch {
    // Usage telemetry is never worth failing a request over.
  }
}
