import { withAdmin } from "../pb-auth";
import { decryptSecret } from "../secret-box";
import {
  getServiceDef,
  isRegistryPair,
  type ServiceFieldDef,
} from "./registry";

// Resolution order for every integration config value:
//   1. PocketBase override (consuela_service_config; decrypted when secret)
//   2. process.env fallback
//   3. null
// Read per-request — family scale makes this cheap, and edits apply instantly.

export interface ServiceFieldStatus {
  key: string;
  label: string;
  helpText: string;
  secret: boolean;
  required: boolean;
  set: boolean;
  source: "db" | "env" | "unset";
  preview?: string;
  /** Stored secret exists but can't be decrypted (e.g. the server's
   *  CONSUELA_ENCRYPTION_KEY changed since the value was saved). The
   *  runtime falls back to env — the owner should re-enter the value. */
  unreadable?: boolean;
}

interface StoredRead {
  /** Raw row value (null when no row exists). */
  raw: string | null;
  /** Row exists and is a secret that failed to decrypt. */
  unreadable: boolean;
  /** Decrypted/plain value when readable (null otherwise). */
  value: string | null;
}

async function readStoredRow(
  service: string,
  key: string,
  secret: boolean
): Promise<string | null> {
  const read = await readStoredRowDetailed(service, key, secret);
  return read.value;
}

async function readStoredRowDetailed(
  service: string,
  key: string,
  secret: boolean
): Promise<StoredRead> {
  const rows = (await withAdmin(async (pb) =>
    pb.collection("consuela_service_config").getFullList({
      requestKey: null,
      filter: `service = "${service.replace(/"/g, "")}" && key = "${key.replace(/"/g, "")}"`,
    })
  )) as any[];
  const row: any = rows[0];
  if (!row) return { raw: null, unreadable: false, value: null };
  if (!secret) return { raw: row.value ?? null, unreadable: false, value: row.value ?? null };
  // Corrupt ciphertext (wrong/rotated encryption key) → warn once and let the
  // caller fall back to env rather than silently feeding garbage upstream.
  const plain = decryptSecret(row.value);
  if (plain === null) {
    console.warn(`[services] stored value for ${service}.${key} could not be decrypted; using env fallback`);
    return { raw: row.value ?? null, unreadable: true, value: null };
  }
  return { raw: row.value ?? null, unreadable: false, value: plain };
}

export async function getServiceConfig(
  service: string,
  key: string
): Promise<string | null> {
  if (!isRegistryPair(service, key)) return null;

  const def = getServiceDef(service)!;
  const field: ServiceFieldDef | undefined = def.fields.find((f) => f.key === key);
  const secret = field?.secret ?? false;

  const stored = await readStoredRow(service, key, secret);
  if (stored !== null && stored !== "") return stored;
  return process.env[key] || null;
}

export async function getServiceStatus(
  service: string
): Promise<ServiceFieldStatus[]> {
  const def = getServiceDef(service);
  if (!def) return [];
  return Promise.all(
    def.fields.map(async (f) => {
      const read = await readStoredRowDetailed(service, f.key, f.secret);
      const envVal = process.env[f.key] || "";
      const storedReadable = read.value !== null && read.value !== "";
      const set = storedReadable || envVal !== "";
      return {
        key: f.key,
        label: f.label,
        helpText: f.helpText,
        secret: f.secret,
        required: f.required,
        set,
        source: storedReadable
          ? ("db" as const)
          : envVal !== ""
            ? ("env" as const)
            : read.raw !== null
              ? ("db" as const) // row exists but is unreadable — flag below
              : ("unset" as const),
        preview: f.secret && set ? (storedReadable ? read.value! : envVal).slice(-2) : undefined,
        unreadable: read.unreadable || undefined,
      } satisfies ServiceFieldStatus;
    })
  );
}
