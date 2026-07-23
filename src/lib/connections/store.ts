/**
 * Connection Store — Client-side storage for API keys and connection state.
 *
 * Keys are stored in localStorage with a simple obfuscation layer.
 * For production, consider using PocketBase encrypted fields or
 * a proper secrets manager.
 *
 * The client passes credentials to API routes via request headers,
 * so keys never sit in .env.local for user-configured services.
 */

import type { ConnectionStatus, ConnectionCredentials, StoredConnection } from "./types";

const STORAGE_KEY = "consuela-connections";

// Simple obfuscation (not encryption — for production use a proper crypto library)
function obfuscate(value: string): string {
  if (typeof window === "undefined") return value;
  return btoa(encodeURIComponent(value));
}

function deobfuscate(value: string): string {
  if (typeof window === "undefined") return value;
  try {
    return decodeURIComponent(atob(value));
  } catch {
    return value;
  }
}

/**
 * Load all connection states from localStorage.
 */
export function loadConnections(): Record<string, StoredConnection> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Deobfuscate credentials
    const result: Record<string, StoredConnection> = {};
    for (const [id, conn] of Object.entries(parsed) as [string, any][]) {
      result[id] = {
        ...conn,
        credentials: Object.fromEntries(
          Object.entries(conn.credentials || {}).map(([k, v]) => [k, deobfuscate(v as string)])
        ),
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Save all connection states to localStorage.
 */
export function saveConnections(connections: Record<string, StoredConnection>): void {
  if (typeof window === "undefined") return;
  try {
    // Obfuscate credentials before saving
    const toSave: Record<string, any> = {};
    for (const [id, conn] of Object.entries(connections)) {
      toSave[id] = {
        ...conn,
        credentials: Object.fromEntries(
          Object.entries(conn.credentials || {}).map(([k, v]) => [k, obfuscate(v as string)])
        ),
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error("Failed to save connections:", e);
  }
}

/**
 * Get a single connection's status and credentials.
 */
export function getConnection(id: string): StoredConnection | null {
  const all = loadConnections();
  return all[id] || null;
}

/**
 * Check if a connection is active and has valid credentials.
 */
export function isConnected(id: string): boolean {
  const conn = getConnection(id);
  if (!conn) return false;
  if (conn.status !== "connected") return false;
  return Object.values(conn.credentials).some((v) => v.trim().length > 0);
}

/**
 * Get the credentials for a connection (deobfuscated).
 * Used by API route callers to pass keys in request headers.
 */
export function getCredentials(id: string): ConnectionCredentials | null {
  const conn = getConnection(id);
  if (!conn || conn.status !== "connected") return null;
  return conn.credentials;
}

/**
 * Connect a service — save credentials and mark as connected.
 */
export function connect(
  id: string,
  credentials: ConnectionCredentials,
): StoredConnection {
  const all = loadConnections();
  const connection: StoredConnection = {
    id,
    status: "connected",
    credentials,
    connectedAt: new Date().toISOString(),
  };
  all[id] = connection;
  saveConnections(all);
  return connection;
}

/**
 * Disconnect a service — remove credentials.
 */
export function disconnect(id: string): void {
  const all = loadConnections();
  delete all[id];
  saveConnections(all);
}

/**
 * Update connection status (e.g., after a test fails).
 */
export function updateStatus(id: string, status: ConnectionStatus, error?: string): void {
  const all = loadConnections();
  if (all[id]) {
    all[id].status = status;
    if (error) all[id].lastError = error;
    else delete all[id].lastError;
    saveConnections(all);
  }
}
