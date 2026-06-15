import type { DeviceGrantResponse, DeviceTokenSuccess } from "./types";

const GOOGLE_DEVICE_GRANT_URL = "https://oauth2.googleapis.com/device/code";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function requireClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_CLIENT_ID is not set. Create an OAuth client of type 'TVs and Limited Input Devices' in Google Cloud Console, then add the credentials to .env.local.",
    );
  }
  return id;
}

function requireClientSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) {
    throw new Error("GOOGLE_CLIENT_SECRET is not set (required for device flow).");
  }
  return s;
}

export function getDefaultScopes(): string[] {
  const fromEnv = process.env.GOOGLE_OAUTH_SCOPES;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.split(/[\s,]+/).filter(Boolean);
  }
  return [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
  ];
}

export async function requestDeviceGrant(): Promise<DeviceGrantResponse> {
  const client_id = requireClientId();
  const client_secret = requireClientSecret();
  const scope = getDefaultScopes().join(" ");

  const body = new URLSearchParams({
    client_id,
    client_secret,
    scope,
  });

  const res = await fetch(GOOGLE_DEVICE_GRANT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google device grant failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_url: data.verification_url || "https://www.google.com/device",
    expires_in: data.expires_in,
    interval: Math.max(5, data.interval || 5),
  };
}

export type PollResult =
  | { status: "pending"; error: "authorization_pending" | "slow_down"; interval: number }
  | { status: "denied"; error: "access_denied" }
  | { status: "expired"; error: "expired_token" }
  | { status: "complete"; tokens: DeviceTokenSuccess };

export async function pollForToken(
  deviceCode: string,
  currentInterval: number,
): Promise<PollResult> {
  const client_id = requireClientId();
  const client_secret = requireClientSecret();

  const body = new URLSearchParams({
    client_id,
    client_secret,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as Record<string, any>;

  if (!res.ok || data.error) {
    const errCode: string = data.error || "unknown_error";
    if (errCode === "authorization_pending") {
      return { status: "pending", error: "authorization_pending", interval: currentInterval };
    }
    if (errCode === "slow_down") {
      return {
        status: "pending",
        error: "slow_down",
        interval: currentInterval + 5,
      };
    }
    if (errCode === "access_denied") {
      return { status: "denied", error: "access_denied" };
    }
    if (errCode === "expired_token") {
      return { status: "expired", error: "expired_token" };
    }
    throw new Error(`Google token poll failed: ${errCode} (${data.error_description || ""})`);
  }

  return {
    status: "complete",
    tokens: {
      status: "complete",
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      id_token: data.id_token || null,
      expires_in: data.expires_in || 3600,
      scope: data.scope || "",
      token_type: "Bearer",
    },
  };
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email || null;
  } catch {
    return null;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
  const client_id = requireClientId();
  const client_secret = requireClientSecret();

  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`refresh failed (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
  };
  return data;
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return res.ok;
  } catch {
    return false;
  }
}
