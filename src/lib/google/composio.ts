import { getServiceConfig } from "@/lib/services/config";
import {
  COMPOSIO_ACTIONS,
  COMPOSIO_EXECUTE_PATH,
  COMPOSIO_CONNECTED_ACCOUNTS_PATH,
  COMPOSIO_CONNECTED_ACCOUNT_LINK_PATH,
  COMPOSIO_AUTH_CONFIGS_PATH,
  COMPOSIO_TOOLKITS,
  COMPOSIO_CONNECT_FLOW_NOTES,
} from "./composio-actions";

export type ComposioErrorCode = "not_configured" | "auth_failed" | "not_connected" | "api_error";

export class ComposioError extends Error {
  code: ComposioErrorCode;
  status?: number;
  constructor(code: ComposioErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ComposioError";
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 30_000;

export async function getComposioKey(): Promise<string> {
  let key: string | null = null;
  try {
    key = await getServiceConfig("composio", "COMPOSIO_API_KEY");
  } catch {
    throw new ComposioError("not_configured", "Composio key unreadable");
  }
  if (!key) throw new ComposioError("not_configured", "Composio key is not configured");
  return key;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ComposioError("api_error", e instanceof Error ? e.message : "Composio request failed");
  }
}

function classify(status: number): ComposioError {
  if (status === 401 || status === 403) {
    return new ComposioError("auth_failed", `Composio auth failed (${status})`, status);
  }
  return new ComposioError("api_error", `Composio error (${status})`, status);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function firstId(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function executeComposioAction<T>(
  action: string, args: Record<string, unknown>, connectedAccountId?: string,
): Promise<T> {
  if (!action) throw new ComposioError("api_error", "No Composio action is pinned for this capability");
  const key = await getComposioKey();
  const body: Record<string, unknown> = { arguments: args };
  if (connectedAccountId) body.connected_account_id = connectedAccountId;
  const res = await call(`${COMPOSIO_EXECUTE_PATH}/${action}`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw classify(res.status);
  const data = await readJson(res);
  if (data === null) throw new ComposioError("api_error", "Composio returned an empty response");
  return data as T;
}

export async function ensureAuthConfig(toolkit: string): Promise<string> {
  const key = await getComposioKey();
  const listRes = await call(`${COMPOSIO_AUTH_CONFIGS_PATH}?toolkit_slug=${encodeURIComponent(toolkit)}`, {
    method: "GET", headers: { "X-API-Key": key },
  });
  if (listRes.ok) {
    const list = asRecord(await readJson(listRes));
    const items = Array.isArray(list?.items) ? list.items : Array.isArray(list?.data) ? list.data : [];
    const found = items.map((item) => firstId(asRecord(item)?.id)).find((id) => id !== null);
    if (found) return found;
  } else if (listRes.status !== 404) {
    throw classify(listRes.status);
  }
  const createRes = await call(COMPOSIO_AUTH_CONFIGS_PATH, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ toolkit: { slug: toolkit }, auth_config: { type: "use_composio_managed_auth" } }),
  });
  if (!createRes.ok) throw classify(createRes.status);
  const created = asRecord(await readJson(createRes));
  const id = firstId(created?.id, asRecord(created?.auth_config)?.id, asRecord(created?.data)?.id);
  if (!id) throw new ComposioError("api_error", "Composio did not return an auth config id");
  return id;
}

export async function createConnectedAccountLink(
  toolkit: string,
): Promise<{ redirectUrl: string; connectedAccountId: string; expiresAt: string | null }> {
  const key = await getComposioKey();
  const authConfigId = await ensureAuthConfig(toolkit);
  const res = await call(COMPOSIO_CONNECTED_ACCOUNT_LINK_PATH, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_config_id: authConfigId, user_id: COMPOSIO_CONNECT_FLOW_NOTES.USER_ID }),
  });
  if (!res.ok) throw classify(res.status);
  const d = asRecord(await readJson(res));
  const redirectUrl = typeof d?.redirect_url === "string" ? d.redirect_url : null;
  const connectedAccountId = firstId(d?.connected_account_id);
  if (!redirectUrl || !connectedAccountId) {
    throw new ComposioError("api_error", "Composio did not return an auth link");
  }
  const expiresAt = typeof d?.expires_at === "string" ? d.expires_at : null;
  return { redirectUrl, connectedAccountId, expiresAt };
}

export async function deleteConnectedAccount(id: string): Promise<boolean> {
  const key = await getComposioKey();
  const res = await call(`${COMPOSIO_CONNECTED_ACCOUNTS_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "X-API-Key": key },
  });
  if (res.ok || res.status === 404) return true;
  throw classify(res.status);
}

export async function getConnectedAccount(
  id: string,
): Promise<{ id: string; status: string; toolkitSlug: string; email: string | null } | null> {
  const key = await getComposioKey();
  const res = await call(`${COMPOSIO_CONNECTED_ACCOUNTS_PATH}/${encodeURIComponent(id)}`, {
    method: "GET", headers: { "X-API-Key": key },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw classify(res.status);
  const d = asRecord(await readJson(res));
  const toolkit = asRecord(d?.toolkit);
  const userInfo = asRecord(asRecord(d?.params)?.user_info);
  const statusSource = d?.status ?? d?.state;
  return {
    id: firstId(d?.id) ?? id,
    status: String(statusSource ?? "").toUpperCase(),
    toolkitSlug: typeof toolkit?.slug === "string" ? toolkit.slug : typeof d?.appName === "string" ? d.appName : "",
    email: typeof userInfo?.email === "string" ? userInfo.email : typeof d?.email === "string" ? d.email : null,
  };
}

export { COMPOSIO_ACTIONS, COMPOSIO_TOOLKITS };
