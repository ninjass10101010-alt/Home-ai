import { withKeyedLock } from "@/lib/keyed-lock";
import { withAdmin } from "../pb-auth.ts";
import { encrypt, decrypt } from "./encryption.ts";
import type { StoredTokens } from "./types.ts";

const COLLECTION = "consuela_google_tokens";
const TOKEN_LOCK = "google-token-store";

function canonicalTokenRow(rows: any[]): any | null {
  if (rows.length === 0) return null;
  const active = rows.filter((row) => !row.revoked_at);
  const candidates = active.length > 0 ? active : rows;
  return [...candidates].sort((a, b) => {
    const aTime = Date.parse(String(a.granted_at || a.created || "")) || 0;
    const bTime = Date.parse(String(b.granted_at || b.created || "")) || 0;
    return bTime - aTime || String(b.id || "").localeCompare(String(a.id || ""));
  })[0];
}

export interface PublicTokenState {
  connected: boolean;
  account_email: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  scope: string | null;
  minutes_until_expiry: number | null;
}

function toPublic(row: StoredTokens | null): PublicTokenState {
  if (!row) {
    return {
      connected: false,
      account_email: null,
      granted_at: null,
      revoked_at: null,
      expires_at: null,
      scope: null,
      minutes_until_expiry: null,
    };
  }
  return {
    connected: !row.revoked_at,
    account_email: row.account_email,
    granted_at: row.granted_at,
    revoked_at: row.revoked_at,
    expires_at: new Date(row.expires_at).toISOString(),
    scope: row.scope,
    minutes_until_expiry: Math.max(
      0,
      Math.round((row.expires_at - Date.now()) / 60000),
    ),
  };
}

export type PublicTokenStateReadResult =
  | { status: "available"; state: PublicTokenState }
  | { status: "unavailable"; error: "google_state_unavailable" };

export async function getStoredTokensStrict(): Promise<StoredTokens | null> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({ requestKey: null });
    const row = canonicalTokenRow(rows as any[]);
    if (!row) return null;
    const revokedAt = row.revoked_at || null;
    return {
      access_token: revokedAt ? "" : decrypt(row.access_token),
      refresh_token: revokedAt ? "" : row.refresh_token ? decrypt(row.refresh_token) : "",
      scope: row.scope || "",
      token_type: (row.token_type as "Bearer") || "Bearer",
      expires_at: row.expires_at ? new Date(row.expires_at).getTime() : 0,
      account_email: row.account_email || null,
      granted_at: row.granted_at || "",
      revoked_at: revokedAt,
    };
  });
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  try {
    const tokens = await getStoredTokensStrict();
    return tokens?.revoked_at ? null : tokens;
  } catch (error: any) {
    console.error("[google-tokens] getStoredTokens failed:", error?.message);
    return null;
  }
}

export async function saveTokens(args: {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expires_in: number;
  account_email: string | null;
}): Promise<StoredTokens> {
  return withKeyedLock(TOKEN_LOCK, () => withAdmin(async (pb) => {
    const expires_at = new Date(Date.now() + args.expires_in * 1000);
    const granted_at = new Date();

    const access_enc = encrypt(args.access_token);
    const refresh_enc = encrypt(args.refresh_token);

    const existing = [...(await pb.collection(COLLECTION).getFullList({ requestKey: null })) as any[]];
    const payload = {
      access_token: access_enc,
      refresh_token: refresh_enc,
      scope: args.scope,
      token_type: args.token_type,
      expires_at: expires_at.toISOString(),
      account_email: args.account_email,
      granted_at: granted_at.toISOString(),
      revoked_at: null as string | null,
    };
    const row = canonicalTokenRow(existing as any[]);
    if (row) {
      await pb.collection(COLLECTION).update(row.id, payload, { requestKey: null });
    } else {
      await pb.collection(COLLECTION).create(payload, { requestKey: null });
    }
    for (const extra of existing as any[]) {
      if (!row || extra.id !== row.id) {
        await pb.collection(COLLECTION).delete(extra.id, { requestKey: null });
      }
    }

    return {
      access_token: args.access_token,
      refresh_token: args.refresh_token,
      scope: args.scope,
      token_type: "Bearer",
      expires_at: expires_at.getTime(),
      account_email: args.account_email,
      granted_at: granted_at.toISOString(),
      revoked_at: null,
    };
  }));
}

export async function updateAccessToken(
  access_token: string,
  expires_in: number,
): Promise<void> {
  return withKeyedLock(TOKEN_LOCK, () => withAdmin(async (pb) => {
    const existing = await pb.collection(COLLECTION).getFullList({ requestKey: null });
    const row = canonicalTokenRow(existing as any[]);
    if (!row) return;
    await pb.collection(COLLECTION).update(
      row.id,
      {
        access_token: encrypt(access_token),
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      },
      { requestKey: null },
    );
  }));
}

export async function revokeTokens(): Promise<boolean> {
  return withKeyedLock(TOKEN_LOCK, () => withAdmin(async (pb) => {
    const existing = await pb.collection(COLLECTION).getFullList({ requestKey: null });
    const row = canonicalTokenRow(existing as any[]);
    if (!row) return true;
    await pb.collection(COLLECTION).update(
      row.id,
      {
        revoked_at: new Date().toISOString(),
        access_token: null,
        refresh_token: null,
      },
      { requestKey: null },
    );
    for (const extra of existing as any[]) {
      if (extra.id !== row.id) {
        await pb.collection(COLLECTION).delete(extra.id, { requestKey: null });
      }
    }
    return true;
  }));
}

export async function clearDirectGoogleCache(): Promise<boolean> {
  return withKeyedLock(TOKEN_LOCK, () => withAdmin(async (pb) => {
    const eventRows = await pb.collection("consuela_google_calendar_events").getFullList({ requestKey: null });
    for (const row of eventRows as any[]) {
      await pb.collection("consuela_google_calendar_events").delete(row.id, { requestKey: null });
    }
    const calendarRows = await pb.collection("consuela_google_calendar_sync").getFullList({ requestKey: null });
    for (const row of calendarRows as any[]) {
      await pb.collection("consuela_google_calendar_sync").delete(row.id, { requestKey: null });
    }
    const legacyRows = await pb.collection("consuela_google_sync_state").getFullList({ requestKey: null });
    for (const row of legacyRows as any[]) {
      if (row.resource === "calendar") {
        await pb.collection("consuela_google_sync_state").delete(row.id, { requestKey: null });
      }
    }
    return true;
  }));
}

export async function readPublicState(): Promise<PublicTokenStateReadResult> {
  try {
    return { status: "available", state: toPublic(await getStoredTokensStrict()) };
  } catch {
    return { status: "unavailable", error: "google_state_unavailable" };
  }
}

export async function getPublicState(): Promise<PublicTokenState> {
  const result = await readPublicState();
  if (result.status === "unavailable") throw new Error(result.error);
  return result.state;
}
