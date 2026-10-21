import { withAdmin } from "../pb-auth.ts";
import { withKeyedLock } from "@/lib/keyed-lock";

const SNAPSHOT_COLLECTION = "consuela_data_snapshots";
const SNAPSHOT_KEY = "google_composio_connection";
const LOCK = "google-connection-state";

export const TASKS_SNAPSHOT_KEY = "google_composio_tasks";

export type GoogleAuthErrorCode = "no_grant" | "unavailable" | "revoked" | "expired" | "refresh_failed" | "config" | "not_configured";

export class GoogleAuthError extends Error {
  code: GoogleAuthErrorCode;
  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function mapGoogleAuthError(error: unknown) {
  if (error instanceof GoogleAuthError) {
    const status =
      error.code === "unavailable" || error.code === "not_configured"
        ? 503
        : error.code === "no_grant"
          ? 409
          : 401;
    return { status, body: { ok: false as const, code: error.code, error: error.message } };
  }
  const message = error instanceof Error && error.message ? error.message : "Unknown Google auth error";
  return { status: 500, body: { ok: false as const, code: "unknown" as const, error: message } };
}

export interface ConnectionSnapshot {
  connectedAccountId: string | null;
  status: string | null;
  accountEmail: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
}

const EMPTY: ConnectionSnapshot = {
  connectedAccountId: null,
  status: null,
  accountEmail: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

function snapshotFilter(key: string): string {
  return `key = "${key}"`;
}

export async function readConnectionSnapshot(key: string = SNAPSHOT_KEY): Promise<ConnectionSnapshot> {
  return withAdmin(async (pb) => {
    const rows = (await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: snapshotFilter(key),
    })) as any[];
    const row = rows[0];
    if (!row) return { ...EMPTY };
    const d = row.data ?? {};
    return {
      connectedAccountId: d.connectedAccountId ?? null,
      status: d.status ?? null,
      accountEmail: d.accountEmail ?? null,
      connectedAt: d.connectedAt ?? null,
      lastVerifiedAt: d.lastVerifiedAt ?? null,
    };
  });
}

export async function writeConnectionSnapshot(
  patch: Partial<ConnectionSnapshot>,
  key: string = SNAPSHOT_KEY,
): Promise<void> {
  await withKeyedLock(LOCK, () =>
    withAdmin(async (pb) => {
      const rows = (await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: snapshotFilter(key),
      })) as any[];
      const current = rows[0]?.data ?? {};
      const data = { ...EMPTY, ...current, ...patch };
      const payload = { key, data, updated_at: new Date().toISOString() };
      if (rows[0]) await pb.collection(SNAPSHOT_COLLECTION).update(rows[0].id, payload, { requestKey: null });
      else await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
    }),
  );
}

export async function clearConnectionSnapshot(key: string = SNAPSHOT_KEY): Promise<void> {
  await withKeyedLock(LOCK, () =>
    withAdmin(async (pb) => {
      const rows = (await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: snapshotFilter(key),
      })) as any[];
      for (const r of rows) await pb.collection(SNAPSHOT_COLLECTION).delete(r.id, { requestKey: null });
    }),
  );
}

export async function isGoogleConnected(): Promise<boolean> {
  try {
    const s = await readConnectionSnapshot();
    return !!s.connectedAccountId && s.status === "ACTIVE";
  } catch (e) {
    throw new GoogleAuthError("unavailable", "Google connection state unavailable");
  }
}

export async function disconnectGoogle(): Promise<void> {
  await clearConnectionSnapshot();
}
