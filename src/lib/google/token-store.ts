import { withAdmin } from "../pb-auth.ts";
import { encrypt, decrypt } from "./encryption.ts";
import type { StoredTokens } from "./types.ts";

const COLLECTION = "consuela_google_tokens";

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

export async function getStoredTokens(): Promise<StoredTokens | null> {
  return withAdmin(async (pb) => {
    try {
      const rows = await pb.collection(COLLECTION).getFullList({ requestKey: null });
      if (rows.length === 0) return null;
      const row: any = rows[0];
      return {
        access_token: decrypt(row.access_token),
        refresh_token: row.refresh_token ? decrypt(row.refresh_token) : "",
        scope: row.scope || "",
        token_type: (row.token_type as "Bearer") || "Bearer",
        expires_at: row.expires_at ? new Date(row.expires_at).getTime() : 0,
        account_email: row.account_email || null,
        granted_at: row.granted_at || "",
        revoked_at: row.revoked_at || null,
      };
    } catch (e: any) {
      console.error("[google-tokens] getStoredTokens failed:", e.message);
      return null;
    }
  });
}

export async function saveTokens(args: {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expires_in: number;
  account_email: string | null;
}): Promise<StoredTokens> {
  return withAdmin(async (pb) => {
    const expires_at = new Date(Date.now() + args.expires_in * 1000);
    const granted_at = new Date();

    const access_enc = encrypt(args.access_token);
    const refresh_enc = encrypt(args.refresh_token);

    const existing = await pb.collection(COLLECTION).getFullList({ requestKey: null });
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
    if (existing.length > 0) {
      const row: any = existing[0];
      await pb.collection(COLLECTION).update(row.id, payload, { requestKey: null });
    } else {
      await pb.collection(COLLECTION).create(payload, { requestKey: null });
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
  });
}

export async function updateAccessToken(
  access_token: string,
  expires_in: number,
): Promise<void> {
  return withAdmin(async (pb) => {
    const existing = await pb.collection(COLLECTION).getFullList({ requestKey: null });
    if (existing.length === 0) return;
    const row: any = existing[0];
    await pb.collection(
      COLLECTION,
    ).update(
      row.id,
      {
        access_token: encrypt(access_token),
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      },
      { requestKey: null },
    );
  });
}

export async function revokeTokens(): Promise<boolean> {
  return withAdmin(async (pb) => {
    const existing = await pb.collection(COLLECTION).getFullList({ requestKey: null });
    if (existing.length === 0) return true;
    const row: any = existing[0];
    await pb.collection(COLLECTION).update(
      row.id,
      {
        revoked_at: new Date().toISOString(),
        access_token: null,
        refresh_token: null,
      },
      { requestKey: null },
    );
    return true;
  });
}

export async function getPublicState(): Promise<PublicTokenState> {
  const tokens = await getStoredTokens();
  return toPublic(tokens);
}
