// Dashboard-owned LLM provider registry (2026-09-07) — the ONLY brain config.
// PocketBase collection `consuela_ai_providers`; apiKey holds encryptSecret()
// ciphertext; models is a JSON string[] in chain order (index 0 = active).

import { withAdmin } from "@/lib/pb-auth";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";

export interface AiProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string | null;
  models: string[];
  enabled: boolean;
  order: number;
}

export interface AiProviderInput {
  id?: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string | null;
  models: string[];
  enabled?: boolean;
  order?: number;
}

const COLLECTION = "consuela_ai_providers";

/** The route appends /v1/chat/completions, so a user-pasted ".../v1" base is
 *  normalized to the host root (either paste form works). */
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
}

function normalizeModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return models.map((m) => String(m).trim()).filter(Boolean);
}

function mapRow(row: any): AiProviderRecord {
  let models: string[] = [];
  try {
    models = normalizeModels(JSON.parse(row.models || "[]"));
  } catch {
    models = [];
  }
  return {
    id: String(row.id),
    displayName: String(row.displayName || ""),
    baseUrl: normalizeBaseUrl(String(row.baseUrl || "")),
    apiKey: decryptSecret(row.apiKey) ?? null,
    models,
    enabled: row.enabled !== false,
    order: typeof row.order === "number" ? row.order : Number(row.order ?? 0),
  };
}

export async function listAiProviders(): Promise<AiProviderRecord[]> {
  try {
    const rows = (await withAdmin(async (pb) =>
      pb.collection(COLLECTION).getFullList({ requestKey: null, sort: "order" })
    )) as any[];
    return rows
      .map(mapRow)
      .sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName));
  } catch (err) {
    console.error("[ai/providers] list failed:", (err as Error).message);
    return [];
  }
}

export async function upsertAiProvider(input: AiProviderInput): Promise<AiProviderRecord> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const models = normalizeModels(input.models);
  if (!input.displayName.trim()) throw new Error("displayName is required");
  if (!baseUrl) throw new Error("baseUrl is required");
  if (models.length === 0) throw new Error("at least one model is required");

  const data: Record<string, unknown> = {
    displayName: input.displayName.trim(),
    baseUrl,
    models: JSON.stringify(models),
    enabled: input.enabled ?? true,
    order: input.order ?? 0,
  };

  return withAdmin(async (pb) => {
    if (input.id) {
      const existing = (await pb
        .collection(COLLECTION)
        .getFirstListItem(`id = "${input.id.replace(/"/g, "")}"`, { requestKey: null })
        .catch(() => null)) as any;
      if (!existing) throw new Error(`provider ${input.id} not found`);
      // Empty key on update = "leave unchanged" (same contract as member PIN).
      const trimmedKey = (input.apiKey ?? "").trim();
      data.apiKey = trimmedKey ? encryptSecret(trimmedKey) : existing.apiKey;
      const updated = await pb.collection(COLLECTION).update(input.id, data, { requestKey: null });
      return mapRow(updated);
    }
    const trimmedKey = (input.apiKey ?? "").trim();
    if (trimmedKey) data.apiKey = encryptSecret(trimmedKey);
    const created = await pb.collection(COLLECTION).create(data, { requestKey: null });
    return mapRow(created);
  });
}

export async function deleteAiProvider(id: string): Promise<boolean> {
  try {
    await withAdmin(async (pb) => pb.collection(COLLECTION).delete(id, { requestKey: null }));
    return true;
  } catch (err) {
    console.error("[ai/providers] delete failed:", (err as Error).message);
    return false;
  }
}
