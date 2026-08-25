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
  secret: boolean;
  required: boolean;
  set: boolean;
  source: "db" | "env" | "unset";
  preview?: string;
}

async function readStoredRow(
  service: string,
  key: string,
  secret: boolean
): Promise<string | null> {
  const rows = (await withAdmin(async (pb) =>
    pb.collection("consuela_service_config").getFullList({
      requestKey: null,
      filter: `service = "${service.replace(/"/g, "")}" && key = "${key.replace(/"/g, "")}"`,
    })
  )) as any[];
  const row: any = rows[0];
  if (!row) return null;
  if (!secret) return row.value ?? null;
  // Corrupt ciphertext (wrong/rotated encryption key) → warn once and let the
  // caller fall back to env rather than silently feeding garbage upstream.
  const plain = decryptSecret(row.value);
  if (plain === null) {
    console.warn(`[services] stored value for ${service}.${key} could not be decrypted; using env fallback`);
    return null;
  }
  return plain;
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
      const stored = await readStoredRow(service, f.key, f.secret);
      const envVal = process.env[f.key] || "";
      const value = stored !== null && stored !== "" ? stored : envVal;
      const set = value !== "";
      return {
        key: f.key,
        label: f.label,
        secret: f.secret,
        required: f.required,
        set,
        source: stored ? ("db" as const) : set ? ("env" as const) : ("unset" as const),
        preview: f.secret && set ? value.slice(-2) : undefined,
      };
    })
  );
}
