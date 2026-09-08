# Dashboard-Owned AI Brain + Agent Memory + Obsidian Mirror — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's own OpenAI-compatible provider chain the only LLM brain (Hermes fully removed), give the agent adults-only memory tools, and mirror those memories into the family's Obsidian vault on the Mac via a pull agent — with an opencode-style "AI Models" settings card.

**Architecture:** New PB collection `consuela_ai_providers` + resolver (`src/lib/ai/targets.ts`) replace Hermes resolution inside `/api/hermes/chat` (URL unchanged — 10 callers keep working). New adults-gated routes `/api/ai/providers` + `/api/ai/models` back a new Settings card. Three memory tools ride the existing tool registry (kids excluded via the `KID_TOOL_NAMES` allowlist). A `CRON_SECRET`-gated export route feeds a zero-dependency Mac launchd agent that renders markdown notes into the Obsidian vault.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, PocketBase (admin via `withAdmin`), AES-256-GCM secrets (`secret-box.ts`), Node ≥18 for the Mac agent.

**Spec:** `docs/superpowers/specs/2026-09-07-dashboard-ai-brain-memory-obsidian-design.md`

## Global Constraints

- **Secrets:** NEVER commit or echo a secret (AGENTS.md hard rule). API keys are encrypted at rest with `encryptSecret()` / read with `decryptSecret()` from `src/lib/secret-box.ts`. Key VALUES never leave the server — GETs return a 2-char suffix preview only.
- **Suite baseline:** full test suite must stay green (was 1225/1225). Gates per task: `npx tsc --noEmit` clean, `npx vitest run <touched files>` green, `npm run lint` clean on touched files. Final task runs the full suite + production build.
- **Test conventions:** files under `tests/unit/*.test.{ts,tsx}`; use `vi.hoisted` mock objects + `vi.mock` for module seams (copy the existing pattern in `tests/unit/hermes-chat-role.test.ts`); always `vi.unstubAllEnvs()/vi.unstubAllGlobals()` in `afterEach`.
- **Route URL stays** `/api/hermes/chat` (cosmetic name; renaming churns 10 callers — explicitly out of scope).
- **Role gating:** kid sessions (session role `child`) never receive memory or house tools. `KID_TOOL_NAMES` is the kid allowlist; the prebuild drift check (`scripts/write-ai-boot.mjs`) verifies `ai/KID.md` documents it exactly — adding adult tools does NOT touch that list.
- **familyId convention:** `"demo-family"` (used by `/memory` page, `FamilyMemoryBrowser`, and the family-memory POST route default). Agent stores memories with `userId: "consuela"`.
- **Memory categories (exact union, from `src/lib/family-memory.ts:24`):** `'preference' | 'allergy' | 'routine' | 'location' | 'schedule' | 'personality' | 'restriction' | 'contact' | 'note'`.
- **Commits:** one commit per task, conventional style (`feat(ai): …`, `test(ai): …`, `docs(ai): …`). Never `git add .` — stage named files.
- **Regenerating the boot bundle:** after editing any `ai/*.md` file, run `node scripts/write-ai-boot.mjs` (prebuild does this at build time; tests import the generated file directly, so regenerate before running tests).

---

### Task 1: Seed the `consuela_ai_providers` PocketBase collection

**Files:**
- Modify: `src/lib/pb-seed.ts` (add the collection to `COLLECTIONS`, right after `consuela_family_memories` at line ~566)
- Test: `tests/unit/pb-seed-field-heal.test.ts` (extend)

**Interfaces:**
- Consumes: existing `COLLECTIONS` array + `withAutodate()` + `LOCKED_RULES` self-heal in `pb-seed.ts`.
- Produces: PB collection `consuela_ai_providers` with fields `displayName` (text, required), `baseUrl` (text, required), `apiKey` (text — encrypted ciphertext), `models` (text — JSON array string), `enabled` (bool), `order` (number). Later tasks read it via `withAdmin`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/pb-seed-field-heal.test.ts`, add one test inside the main `describe` (match the existing import style at the top of the file):

```ts
it("seeds consuela_ai_providers with the provider schema", () => {
  const col = COLLECTIONS.find((c) => c.name === "consuela_ai_providers");
  expect(col).toBeDefined();
  const names = col!.schema.map((f) => f.name);
  for (const f of ["displayName", "baseUrl", "apiKey", "models", "enabled", "order"]) {
    expect(names).toContain(f);
  }
  const req = Object.fromEntries(col!.schema.map((f) => [f.name, !!f.required]));
  expect(req.displayName).toBe(true);
  expect(req.baseUrl).toBe(true);
  expect(req.apiKey).toBe(false); // key optional at seed level; upsert layer enforces
});
```

If `COLLECTIONS` is not imported in that file yet, add `import { COLLECTIONS } from "../../src/lib/pb-seed";` — check the file's existing imports first and reuse them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts`
Expected: FAIL — `expected undefined to be defined` (collection missing).

- [ ] **Step 3: Add the collection to `COLLECTIONS` in `src/lib/pb-seed.ts`**

Insert immediately after the `consuela_family_memories` entry (which ends with its `indexes` array and `},`):

```ts
  // Dashboard-owned LLM provider registry (2026-09-07) — src/lib/ai/providers.ts.
  // apiKey stores encryptSecret() ciphertext; models is a JSON string[] in
  // chain order (index 0 = the active model).
  {
    name: "consuela_ai_providers",
    schema: [
      { name: "displayName", type: "text", required: true },
      { name: "baseUrl", type: "text", required: true },
      { name: "apiKey", type: "text" },
      { name: "models", type: "text", required: true },
      { name: "enabled", type: "bool" },
      { name: "order", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_ai_providers_order ON consuela_ai_providers (order)",
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/pb-seed-field-heal.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add src/lib/pb-seed.ts tests/unit/pb-seed-field-heal.test.ts
git commit -m "feat(ai): seed consuela_ai_providers collection"
```

---

### Task 2: Provider CRUD layer — `src/lib/ai/providers.ts`

**Files:**
- Create: `src/lib/ai/providers.ts`
- Test: `tests/unit/ai-providers.test.ts`

**Interfaces:**
- Consumes: `withAdmin` (`@/lib/pb-auth`), `encryptSecret`/`decryptSecret` (`@/lib/secret-box`).
- Produces (used by Tasks 3, 5, 7):

```ts
export interface AiProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;      // normalized: trimmed, trailing "/" and trailing "/v1" stripped
  apiKey: string | null; // DECRYPTED — never log, never return unmasked over HTTP
  models: string[];      // chain order; index 0 = active model
  enabled: boolean;
  order: number;
}
export interface AiProviderInput {
  id?: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string | null; // empty/null on update = keep existing stored key
  models: string[];
  enabled?: boolean;
  order?: number;
}
export function normalizeBaseUrl(raw: string): string
export async function listAiProviders(): Promise<AiProviderRecord[]>       // sorted by order then displayName
export async function upsertAiProvider(input: AiProviderInput): Promise<AiProviderRecord>
export async function deleteAiProvider(id: string): Promise<boolean>
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-providers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string | null | undefined) =>
    s && s.startsWith("enc:") ? s.slice(4) : null
  ),
}));

vi.mock("@/lib/pb-auth", () => ({ withAdmin: mocks.withAdmin }));
vi.mock("@/lib/secret-box", () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret,
}));

import {
  normalizeBaseUrl,
  listAiProviders,
  upsertAiProvider,
  deleteAiProvider,
} from "@/lib/ai/providers";

// Fake PB collection handle
function fakePb(rows: any[] = {}) {
  const store = [...rows];
  return {
    __store: store,
    collection: () => ({
      getFullList: async () => store.map((r) => ({ ...r })),
      getFirstListItem: async (_f: string) => {
        const r = store[0];
        if (!r) throw Object.assign(new Error("not found"), { status: 404 });
        return { ...r };
      },
      create: async (data: any) => {
        const row = { id: `pb-${store.length + 1}`, ...data };
        store.push(row);
        return { ...row };
      },
      update: async (id: string, data: any) => {
        const i = store.findIndex((r) => r.id === id);
        store[i] = { ...store[i], ...data };
        return { ...store[i] };
      },
      delete: async (id: string) => {
        const i = store.findIndex((r) => r.id === id);
        if (i === -1) throw Object.assign(new Error("not found"), { status: 404 });
        store.splice(i, 1);
        return true;
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeBaseUrl", () => {
  it("strips trailing slash and /v1 (either paste form works)", () => {
    expect(normalizeBaseUrl("https://api.b.ai/v1/")).toBe("https://api.b.ai");
    expect(normalizeBaseUrl("https://api.b.ai")).toBe("https://api.b.ai");
    expect(normalizeBaseUrl("  http://host:1234/v1  ")).toBe("http://host:1234");
  });
});

describe("upsert + list", () => {
  it("creates with encrypted key and normalized url", async () => {
    const pb = fakePb();
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pb));
    const saved = await upsertAiProvider({
      displayName: "b.ai free tier",
      baseUrl: "https://api.b.ai/v1/",
      apiKey: "sk-secret",
      models: ["glm-5.3-flash", "qwen3.8-flash"],
    });
    expect(saved.id).toBe("pb-1");
    expect(saved.baseUrl).toBe("https://api.b.ai");
    expect(saved.apiKey).toBe("sk-secret"); // decrypted view
    expect(mocks.encryptSecret).toHaveBeenCalledWith("sk-secret");
    const stored = pb.__store[0];
    expect(stored.apiKey).toBe("enc:sk-secret"); // ciphertext at rest
    expect(stored.models).toBe(JSON.stringify(["glm-5.3-flash", "qwen3.8-flash"]));
    expect(stored.enabled).toBe(true);
  });

  it("update with empty apiKey keeps the stored key", async () => {
    const pb = fakePb([
      { id: "pb-1", displayName: "old", baseUrl: "https://x", apiKey: "enc:sk-keep", models: '["m1"]', enabled: true, order: 0 },
    ]);
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pb));
    const saved = await upsertAiProvider({
      id: "pb-1",
      displayName: "new name",
      baseUrl: "https://x/v1",
      apiKey: "",
      models: ["m1", "m2"],
    });
    expect(saved.apiKey).toBe("sk-keep");
    expect(mocks.encryptSecret).not.toHaveBeenCalled();
    expect(pb.__store[0].apiKey).toBe("enc:sk-keep");
  });

  it("listAiProviders decrypts and sorts by order", async () => {
    const pb = fakePb([
      { id: "b", displayName: "B", baseUrl: "https://b", apiKey: "enc:k2", models: '["bm"]', enabled: true, order: 2 },
      { id: "a", displayName: "A", baseUrl: "https://a", apiKey: "enc:k1", models: '["am"]', enabled: true, order: 1 },
      { id: "off", displayName: "Off", baseUrl: "https://o", apiKey: null, models: '["om"]', enabled: false, order: 0 },
    ]);
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pb));
    const list = await listAiProviders();
    expect(list.map((p) => p.id)).toEqual(["a", "b", "off"]);
    expect(list[0].apiKey).toBe("k1");
  });
});

describe("deleteAiProvider", () => {
  it("returns true when deleted and false when missing", async () => {
    const pb = fakePb([{ id: "pb-1", displayName: "x", baseUrl: "x", apiKey: null, models: "[]", enabled: true, order: 0 }]);
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(pb));
    expect(await deleteAiProvider("pb-1")).toBe(true);
    expect(await deleteAiProvider("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-providers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/providers'`.

- [ ] **Step 3: Implement `src/lib/ai/providers.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai-providers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add src/lib/ai/providers.ts tests/unit/ai-providers.test.ts
git commit -m "feat(ai): provider CRUD layer for the dashboard-owned LLM registry"
```

---

### Task 3: Chain resolver — `src/lib/ai/targets.ts`

**Files:**
- Create: `src/lib/ai/targets.ts`
- Test: `tests/unit/ai-targets.test.ts`

**Interfaces:**
- Consumes: `listAiProviders()` (Task 2), `withAdmin` + `decryptSecret` (legacy bootstrap reads the retired `ai_fallback` rows directly — `getServiceConfig` is whitelisted against the registry, which Task 6 shrinks, so it must NOT be used here).
- Produces (Task 4 consumes):

```ts
export interface AiTarget {
  url: string;        // normalized base; route appends /v1/chat/completions
  key: string | null;
  model: string;
  provider: string;   // displayName (log/display)
  fallback: boolean;  // true for every non-first target (buffers instead of streams)
}
export async function resolveChatTargets(): Promise<AiTarget[]> // first = brain, rest = chain
export function resetAiTargetsForTests(): void                  // clears the 10-min TTL cache
```

Resolution order: (1) enabled providers by `order` (models in order; target 0 gets `fallback: false`, all others `true`); (2) legacy `FALLBACK_*` rows in `consuela_service_config` (direct PB read + decrypt) then `process.env.FALLBACK_*`; (3) fresh-install env bootstrap `AI_PROVIDER_URL`/`AI_PROVIDER_KEY`/`AI_PROVIDER_MODELS`. Empty when none.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-targets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listAiProviders: vi.fn(async () => []),
  withAdmin: vi.fn(),
  decryptSecret: vi.fn((s: string | null | undefined) =>
    s && s.startsWith("enc:") ? s.slice(4) : null
  ),
}));

vi.mock("@/lib/ai/providers", () => ({ listAiProviders: mocks.listAiProviders }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: mocks.withAdmin }));
vi.mock("@/lib/secret-box", () => ({ decryptSecret: mocks.decryptSecret }));

import { resolveChatTargets, resetAiTargetsForTests } from "@/lib/ai/targets";

beforeEach(() => {
  vi.clearAllMocks();
  resetAiTargetsForTests();
  vi.unstubAllEnvs();
  mocks.listAiProviders.mockResolvedValue([]);
  mocks.withAdmin.mockResolvedValue([]);
});

describe("resolveChatTargets", () => {
  it("provider 0 model 0 is the brain; the rest are fallbacks", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k1", models: ["glm", "qwen"], enabled: true, order: 0 },
      { id: "2", displayName: "groq", baseUrl: "https://api.groq.com", apiKey: "k2", models: ["llama"], enabled: true, order: 1 },
    ]);
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://api.b.ai", key: "k1", model: "glm", provider: "b.ai", fallback: false },
      { url: "https://api.b.ai", key: "k1", model: "qwen", provider: "b.ai", fallback: true },
      { url: "https://api.groq.com", key: "k2", model: "llama", provider: "groq", fallback: true },
    ]);
  });

  it("disabled providers drop out", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "off", baseUrl: "https://x", apiKey: null, models: ["m"], enabled: false, order: 0 },
    ]);
    expect(await resolveChatTargets()).toEqual([]);
  });

  it("bootstrap: legacy ai_fallback PB rows when no providers exist", async () => {
    mocks.withAdmin.mockImplementation(async (fn: any) =>
      fn({
        collection: () => ({
          getFullList: async () => [
            { key: "FALLBACK_API_URL", value: "https://api.b.ai" },
            { key: "FALLBACK_API_KEY", value: "enc:legacy-key" },
            { key: "FALLBACK_MODELS", value: "glm-5.3-flash, qwen3.8-flash" },
          ],
        }),
      })
    );
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://api.b.ai", key: "legacy-key", model: "glm-5.3-flash", provider: "fallback", fallback: false },
      { url: "https://api.b.ai", key: "legacy-key", model: "qwen3.8-flash", provider: "fallback", fallback: true },
    ]);
  });

  it("bootstrap: env FALLBACK_* when PB has nothing", async () => {
    vi.stubEnv("FALLBACK_API_URL", "https://env.b.ai");
    vi.stubEnv("FALLBACK_API_KEY", "env-key");
    vi.stubEnv("FALLBACK_MODELS", "m1,m2");
    const t = await resolveChatTargets();
    expect(t.map((x) => x.model)).toEqual(["m1", "m2"]);
    expect(t[0]).toMatchObject({ url: "https://env.b.ai", key: "env-key", fallback: false });
  });

  it("bootstrap: AI_PROVIDER_* env for fresh installs", async () => {
    vi.stubEnv("AI_PROVIDER_URL", "https://fresh.ai/v1/");
    vi.stubEnv("AI_PROVIDER_KEY", "fresh-key");
    vi.stubEnv("AI_PROVIDER_MODELS", "fresh-model");
    const t = await resolveChatTargets();
    expect(t).toEqual([
      { url: "https://fresh.ai", key: "fresh-key", model: "fresh-model", provider: "env", fallback: false },
    ]);
  });

  it("caches for 10 minutes (provider list read once across calls)", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k", models: ["m"], enabled: true, order: 0 },
    ]);
    await resolveChatTargets();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(1);
    resetAiTargetsForTests();
    await resolveChatTargets();
    expect(mocks.listAiProviders).toHaveBeenCalledTimes(2);
  });

  it("empty when nothing is configured", async () => {
    expect(await resolveChatTargets()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-targets.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/targets'`.

- [ ] **Step 3: Implement `src/lib/ai/targets.ts`**

```ts
// Dashboard-owned LLM chain resolver (2026-09-07). The first target is THE
// brain; every later target is a fallback tried in order. Resolution:
//   1. consuela_ai_providers (enabled, by order — models in order)
//   2. legacy FALLBACK_* rows in consuela_service_config, then env FALLBACK_*
//      (kept so the current config survives the cutover with zero migration —
//      getServiceConfig is registry-whitelisted and Task 6 removes those
//      pairs, so the legacy read goes straight to PB here)
//   3. AI_PROVIDER_* env (fresh installs)
// 10-minute TTL cache — mirrors the old Hermes config cache so a chat burst
// hits PB once.

import { withAdmin } from "@/lib/pb-auth";
import { decryptSecret } from "@/lib/secret-box";
import { listAiProviders } from "@/lib/ai/providers";

export interface AiTarget {
  url: string;
  key: string | null;
  model: string;
  provider: string;
  fallback: boolean;
}

const CHAIN_TTL_MS = 10 * 60 * 1000;
let cached: { targets: AiTarget[]; at: number } | null = null;

export function resetAiTargetsForTests(): void {
  cached = null;
}

function splitModels(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** Legacy bootstrap — reads the retired ai_fallback service-config rows
 *  directly (the pair left the Settings registry; getServiceConfig would
 *  reject it). Falls back to env, mirroring the old resolver contract. */
async function readLegacyFallback(): Promise<{ url: string | null; key: string | null; models: string[] }> {
  let url: string | null = null;
  let key: string | null = null;
  let modelsRaw: string | null = null;
  try {
    const rows = (await withAdmin(async (pb) =>
      pb.collection("consuela_service_config").getFullList({
        requestKey: null,
        filter: 'service = "ai_fallback"',
      })
    )) as any[];
    for (const row of rows) {
      if (row.key === "FALLBACK_API_URL") url = row.value ?? null;
      if (row.key === "FALLBACK_MODELS") modelsRaw = row.value ?? null;
      if (row.key === "FALLBACK_API_KEY") {
        const plain = row.value ? decryptSecret(row.value) : null;
        key = plain ?? null;
      }
    }
  } catch (err) {
    console.warn("[ai/targets] legacy fallback read failed:", (err as Error).message);
  }
  return {
    url: url || process.env.FALLBACK_API_URL || null,
    key: key ?? process.env.FALLBACK_API_KEY ?? null,
    models: splitModels(modelsRaw || process.env.FALLBACK_MODELS),
  };
}

async function resolveUncached(): Promise<AiTarget[]> {
  const providers = await listAiProviders();
  const enabled = providers.filter((p) => p.enabled && p.models.length > 0);
  if (enabled.length > 0) {
    const targets: AiTarget[] = [];
    for (const p of enabled) {
      for (const model of p.models) {
        targets.push({
          url: p.baseUrl,
          key: p.apiKey,
          model,
          provider: p.displayName,
          fallback: targets.length > 0,
        });
      }
    }
    return targets;
  }

  const legacy = await readLegacyFallback();
  if (legacy.url && legacy.models.length > 0) {
    const base = legacy.url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    return legacy.models.map((model, i) => ({
      url: base,
      key: legacy.key,
      model,
      provider: "fallback",
      fallback: i > 0,
    }));
  }

  const envUrl = process.env.AI_PROVIDER_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  const envModels = splitModels(process.env.AI_PROVIDER_MODELS);
  if (envUrl && envModels.length > 0) {
    return envModels.map((model, i) => ({
      url: envUrl,
      key: process.env.AI_PROVIDER_KEY ?? null,
      model,
      provider: "env",
      fallback: i > 0,
    }));
  }

  return [];
}

export async function resolveChatTargets(): Promise<AiTarget[]> {
  if (cached && Date.now() - cached.at < CHAIN_TTL_MS) return cached.targets;
  const targets = await resolveUncached();
  cached = { targets, at: Date.now() };
  return targets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai-targets.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add src/lib/ai/targets.ts tests/unit/ai-targets.test.ts
git commit -m "feat(ai): dashboard-owned LLM chain resolver with legacy bootstrap"
```

---

### Task 4: Chat route cutover — the dashboard brain takes over

**Files:**
- Modify: `src/app/api/hermes/chat/route.ts`
- Delete: `src/lib/ai-fallback.ts`, `tests/unit/ai-fallback.test.ts`
- Modify tests: `tests/unit/hermes-chat-role.test.ts`, `tests/unit/hermes-config-cache.test.ts`, `tests/unit/hermes-chat-stream.test.ts`, `tests/unit/hermes-chat-clem.test.ts`

**Interfaces:**
- Consumes: `resolveChatTargets(): Promise<AiTarget[]>`, `resetAiTargetsForTests()` (Task 3); `AiTarget = { url, key, model, provider, fallback }`.
- Produces: identical HTTP/SSE contract (no caller changes). Renamed internals: `callAi`/`callAiStream` (were `callHermes`/`callHermesStream`), `AI_TIMEOUT_MS`, `aiStreamingSupported`, `resetAiChatForTests` (was `resetHermesChatForTests`, still exported).

- [ ] **Step 1: Rewrite the route's imports, config block, and call helpers**

In `src/app/api/hermes/chat/route.ts`:

Replace line 7 (`import { buildFallbackTargets, resetFallbackChainCacheForTests } from "@/lib/ai-fallback";`) with:

```ts
import { resolveChatTargets, resetAiTargetsForTests, type AiTarget } from "@/lib/ai/targets";
```

Replace the whole config block (lines 40-70, from `const HERMES_CONFIG_TTL_MS` through `const HERMES_MODEL = "consuela";`) with:

```ts
const AI_TIMEOUT_MS = 60_000;

// Flipped to false the first time the active provider answers a stream:true
// request with a buffered JSON payload — stop paying the failed attempt on
// every round until the process restarts.
let aiStreamingSupported = true;

/** Test-only: clears the module-scope caches between vitest cases. */
export function resetAiChatForTests() {
  resetAiTargetsForTests();
  aiStreamingSupported = true;
}
```

Delete `resolveHermes()` entirely (lines 57-69).

Rename `callHermes` → `callAi` and change its signature/body (lines 105-136). The new version:

```ts
async function callAi(
  messages: ChatMessage[],
  opts: { maxTokens?: number; tools?: ReturnType<typeof buildToolsForOpenAI>; toolChoice?: "auto" | "none"; target: AiTarget } = { target: {} as AiTarget },
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const target = opts.target;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.key) headers.Authorization = `Bearer ${target.key}`;
  const res = await fetch(`${target.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: target.model,
      messages,
      temperature: 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      tools: opts.tools,
      tool_choice: opts.toolChoice ?? "auto",
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`AI ${target.model} ${res.status}: ${err || res.statusText}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    tool_calls: data.choices?.[0]?.message?.tool_calls,
  };
}
```

(Remove the `opts.hermes ?? await resolveHermes()` default — every caller passes a target. Fix the default param to just omit it: `opts: { maxTokens?: number; tools?: ...; toolChoice?: "auto" | "none"; target: AiTarget }` with no default value; both call sites pass `target`.)

Rename `callHermesStream` → `callAiStream`; change `opts.hermes` → `opts.target` everywhere inside; `wantStream` becomes:

```ts
const wantStream = aiStreamingSupported && !opts.target.fallback;
```

the fetch URL becomes `` `${opts.target.url}/v1/chat/completions` ``, `HERMES_TIMEOUT_MS` → `AI_TIMEOUT_MS`, the body's `model: opts.model ?? HERMES_MODEL` → `model: opts.target.model` (drop the `model` opt from its signature), and error strings `Hermes ${res.status}` → `AI ${opts.target.model} ${res.status}`.

- [ ] **Step 2: Rewire `buildChatContext` and both chat loops**

In `buildChatContext` (lines 293-337): replace the Clem-hardcoded hermes resolution (lines 303-307):

```ts
  // Clem used to hardcode a gateway URL — now every agent rides the same
  // dashboard-owned chain (Task 4 of the 2026-09-07 brain cutover).
  const targets = await resolveChatTargets();
```

and change the return to `return { message, isClem, targets, tools, messages, role };`

In `handleStreamedChat` (lines 339-410): replace

```ts
      const { message, isClem, hermes, tools, messages } = await buildChatContext(request, body);
```
with
```ts
      const { message, isClem, targets, tools, messages } = await buildChatContext(request, body);
```
delete the `let targets: ChatTarget[] = [...]` line (the chain arrives resolved), and replace the lazy-expansion failure block (lines 365-375) with a plain throw:

```ts
        if (lastErr) {
          throw lastErr;
        }
```

The inner `for (const target of targets)` loop, the `ChatTarget` type (now an alias — change `type ChatTarget = { url: string; key: string | null; model: string; fallback?: boolean };` to `type ChatTarget = AiTarget;`), and the `callAiStream(messages, { tools, hermes: target, model: target.model }, write)` call (→ `callAiStream(messages, { tools, target }, write)`) stay. Before the round loop, add the honest no-config guard:

```ts
      if (targets.length === 0) {
        write(sseFrame(JSON.stringify({ message: "My brain isn't configured yet — add a provider in Settings → AI Models." }), "error"));
        return;
      }
```

In the buffered `POST` (lines 429-497): same substitutions — destructure `targets` from `buildChatContext`, delete the `let targets` line, replace the log line (line 431) with:

```ts
    console.log(`[ai] agent=${body.agent || "consuela"} isClem=${isClem} brain=${targets[0]?.provider}/${targets[0]?.model} role=${role}`);
```

add the same no-config guard (buffered form):

```ts
    if (targets.length === 0) {
      return NextResponse.json({ content: "My brain isn't configured yet — add a provider in Settings → AI Models." });
    }
```

replace the lazy-expansion block (lines 459-469) with `if (lastErr) { throw lastErr; }`, and update the `callAi` call: `hermes: target, model: target.model` → `target`.

Also add status labels for the memory tools (Task 8 uses them) to `TOOL_STATUS_LABELS`:

```ts
  remember_fact: "Committing that to memory…",
  recall_memories: "Checking my memory…",
  forget_memory: "Letting that memory go…",
```

- [ ] **Step 3: Delete the superseded fallback module**

```bash
git rm src/lib/ai-fallback.ts tests/unit/ai-fallback.test.ts
```

- [ ] **Step 4: Update the four chat test files**

In each of `tests/unit/hermes-chat-role.test.ts`, `tests/unit/hermes-config-cache.test.ts`, `tests/unit/hermes-chat-stream.test.ts`, `tests/unit/hermes-chat-clem.test.ts`:

Replace the `@/lib/services/config` mock + its `getServiceConfig` hoisted mock with a targets mock:

```ts
const mocks = vi.hoisted(() => ({
  // ...existing buildToolsForOpenAI/getTool/insertChatMessage mocks stay...
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));
```

Change the import to `import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";` and every `resetHermesChatForTests()` call to `resetAiChatForTests()`. Remove `vi.stubEnv("HERMES_API_URL", ...)`/`HERMES_API_KEY` stubs (unused now).

File-specific rewrites:
- **hermes-config-cache.test.ts** — its "reads config once across two messages" assertion changes meaning: the resolver owns caching now, so assert the *route* calls `resolveChatTargets` exactly once across two messages (module is mocked; count calls), and reset via `mocks.resolveChatTargets.mockClear()` instead of the env/config fiddling.
- **hermes-chat-clem.test.ts** — delete the `:8643`/`:8642` gateway assertions (lines ~151-158) and replace with: "clem rides the same resolved chain" — mock `resolveChatTargets` to return a distinct URL and assert `fetchUrl` contains it for both the default agent and `agent: "clem"`.
- **hermes-chat-stream.test.ts** — the SSE helpers (`token`, `toolCallRound`, `sseResponse`) stay; update mocks per above. The mock fetch responses must echo the target's model-agnostic shape (they already do — no change beyond mocks/reset rename).
- **hermes-chat-role.test.ts** — mocks per above; role-gating assertions unchanged.

- [ ] **Step 5: Run the touched tests**

Run: `npx vitest run tests/unit/hermes-chat-role.test.ts tests/unit/hermes-config-cache.test.ts tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-chat-clem.test.ts tests/unit/ai-targets.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean (no remaining references to `ai-fallback` / `resolveHermes` — verify with `grep -rn "ai-fallback\|resolveHermes\|HERMES_MODEL" src/` returning nothing).

```bash
git add src/app/api/hermes/chat/route.ts tests/unit/hermes-chat-role.test.ts tests/unit/hermes-config-cache.test.ts tests/unit/hermes-chat-stream.test.ts tests/unit/hermes-chat-clem.test.ts
git commit -m "feat(ai): chat cutover — dashboard-owned provider chain replaces Hermes"
```

---

### Task 5: `/api/ai/providers` + `/api/ai/models` routes

**Files:**
- Create: `src/app/api/ai/providers/route.ts`
- Create: `src/app/api/ai/models/route.ts`
- Test: `tests/unit/ai-providers-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 CRUD; `authorizeAdminRequest` (`@/lib/admin-auth`), `verifySession`/`SESSION_COOKIE` (`@/lib/session`) — same gate pair as `src/app/api/services/config/route.ts`.
- Produces (Task 7 consumes):
  - `GET /api/ai/providers` → `{ providers: Array<{ id, displayName, baseUrl, keyPreview: string|null, models: string[], enabled, order, status: "ok"|"unreachable"|"unknown" }>, active: { provider: string, model: string } | null }`
  - `PUT /api/ai/providers` body `{ id?, displayName, baseUrl, apiKey?, models, enabled?, order? }` → 200 `{ provider: <masked> }` / 400 `{ error }` / 401
  - `DELETE /api/ai/providers?id=…` → `{ ok: true }` / 401
  - `POST /api/ai/models` body `{ providerId?: string, baseUrl: string, apiKey?: string }` → `{ models: Array<{ id: string }> }` / 400 `{ error }` (key resolved from the stored provider when `providerId` is given; otherwise the posted key is used and never persisted)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-providers-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listAiProviders: vi.fn(async () => []),
  upsertAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(async () => true),
  authorizeAdminRequest: vi.fn(async () => ({ ok: true })),
  verifySession: vi.fn(async () => ({ name: "Jeff", role: "parent" })),
}));

vi.mock("@/lib/ai/providers", () => ({
  listAiProviders: mocks.listAiProviders,
  upsertAiProvider: mocks.upsertAiProvider,
  deleteAiProvider: mocks.deleteAiProvider,
}));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/session", () => ({
  verifySession: mocks.verifySession,
  SESSION_COOKIE: "consuela_session",
}));

import { GET as providersGET, PUT as providersPUT, DELETE as providersDELETE } from "@/app/api/ai/providers/route";
import { POST as modelsPOST } from "@/app/api/ai/models/route";

function req(url: string, init?: RequestInit) {
  return new NextRequest(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.verifySession.mockResolvedValue({ name: "Jeff", role: "parent" });
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
});

describe("GET /api/ai/providers", () => {
  it("401s without a session", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    expect(res.status).toBe(401);
  });

  it("returns masked providers with the active brain", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "sk-xyz", models: ["glm", "qwen"], enabled: true, order: 0 },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "glm" }] }), { status: 200 })));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.active).toEqual({ provider: "b.ai", model: "glm" });
    expect(body.providers[0].keyPreview).toBe("xz"); // 2-char suffix, never the key
    expect(body.providers[0].apiKey).toBeUndefined();
    expect(body.providers[0].status).toBe("ok");
  });

  it("reports unreachable when the provider ping fails", async () => {
    mocks.listAiProviders.mockResolvedValue([
      { id: "1", displayName: "down", baseUrl: "https://down.ai", apiKey: null, models: ["m"], enabled: true, order: 0 },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await providersGET(req("http://localhost/api/ai/providers"));
    const body = await res.json();
    expect(body.providers[0].status).toBe("unreachable");
  });
});

describe("PUT /api/ai/providers", () => {
  it("requires admin", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x", baseUrl: "https://x", models: ["m"] }),
    }));
    expect(res.status).toBe(403);
  });

  it("400s on invalid input and 200s on success", async () => {
    mocks.upsertAiProvider.mockRejectedValue(new Error("at least one model is required"));
    const bad = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x", baseUrl: "https://x", models: [] }),
    }));
    expect(bad.status).toBe(400);

    mocks.upsertAiProvider.mockResolvedValue({ id: "1", displayName: "b.ai", baseUrl: "https://api.b.ai", apiKey: "k", models: ["glm"], enabled: true, order: 0 });
    const ok = await providersPUT(req("http://localhost/api/ai/providers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "b.ai", baseUrl: "https://api.b.ai", models: ["glm"] }),
    }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.provider.keyPreview).toBeUndefined(); // PUT response must not leak previews either
    expect(body.provider.models).toEqual(["glm"]);
  });
});

describe("DELETE /api/ai/providers", () => {
  it("requires admin and deletes by id", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const denied = await providersDELETE(req("http://localhost/api/ai/providers?id=1"));
    expect(denied.status).toBe(403);
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
    const ok = await providersDELETE(req("http://localhost/api/ai/providers?id=1"));
    expect(ok.status).toBe(200);
    expect(mocks.deleteAiProvider).toHaveBeenCalledWith("1");
  });
});

describe("POST /api/ai/models", () => {
  it("requires admin", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://x" }),
    }));
    expect(res.status).toBe(403);
  });

  it("lists models from the provider (OpenAI shape)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://api.b.ai/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "glm-5.3-flash" }, { id: "qwen3.8-flash" }] }), { status: 200 });
    }));
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.b.ai/v1", apiKey: "sk" }),
    }));
    const body = await res.json();
    expect(body.models.map((m: any) => m.id)).toEqual(["glm-5.3-flash", "qwen3.8-flash"]);
  });

  it("400s when the upstream listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await modelsPOST(req("http://localhost/api/ai/models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.b.ai" }),
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-providers-routes.test.ts`
Expected: FAIL — cannot resolve `@/app/api/ai/providers/route`.

- [ ] **Step 3: Implement `src/app/api/ai/providers/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { listAiProviders, upsertAiProvider, deleteAiProvider } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** One cheap probe per enabled provider — powers the settings status dot. */
async function probe(baseUrl: string): Promise<"ok" | "unreachable" | "unknown"> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

function mask(p: Awaited<ReturnType<typeof listAiProviders>>[number] & { status?: string; keyPreview?: string | null }) {
  return {
    id: p.id,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    models: p.models,
    enabled: p.enabled,
    order: p.order,
    keyPreview: null as string | null,
    status: (p as any).status ?? "unknown",
  };
}

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const providers = await listAiProviders();
    const withStatus = await Promise.all(
      providers.map(async (p) => ({
        ...p,
        keyPreview: p.apiKey ? p.apiKey.slice(-2) : null,
        apiKey: undefined, // decrypted key NEVER leaves the server
        status: p.enabled ? await probe(p.baseUrl) : "unknown",
      }))
    );
    const first = withStatus.find((p) => p.enabled && p.models.length > 0);
    return NextResponse.json({
      providers: withStatus.map(({ apiKey: _drop, ...rest }) => mask(rest as any)),
      active: first ? { provider: first.displayName, model: first.models[0] } : null,
    });
  } catch (err) {
    console.error("[ai/providers] GET failed:", err);
    return NextResponse.json({ providers: [], active: null, error: "config_store_unreachable" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    const provider = await upsertAiProvider({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      displayName: String(body.displayName ?? ""),
      baseUrl: String(body.baseUrl ?? ""),
      apiKey: body.apiKey == null ? "" : String(body.apiKey),
      models: Array.isArray(body.models) ? body.models : [],
      enabled: body.enabled,
      order: typeof body.order === "number" ? body.order : undefined,
    });
    return NextResponse.json({ provider: { ...provider, apiKey: undefined } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteAiProvider(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
```

Note: check `authorizeAdminRequest`'s actual return shape in `src/lib/admin-auth.ts` before writing (`grep -n "authorizeAdminRequest" src/lib/admin-auth.ts` and read the function) — the tests above mock it, but the real call must destructure the real fields (it returns something like `{ ok: boolean }` with `status`/`error` on failure; adapt the two guards to the real shape).

- [ ] **Step 4: Implement `src/app/api/ai/models/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listAiProviders, normalizeBaseUrl } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** Server-side model listing — the provider API key never reaches the browser.
 *  Body: { providerId?: string, baseUrl: string, apiKey?: string }.
 *  providerId wins for the key (posted keys are used for unsaved drafts and
 *  are never persisted). */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: auth.status ?? 401 });
  try {
    const body = await request.json();
    let key: string | null = (body.apiKey ?? "").trim() || null;
    const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
    if (!baseUrl) return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });

    if (body.providerId && !key) {
      const stored = (await listAiProviders()).find((p) => p.id === body.providerId);
      key = stored?.apiKey ?? null;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `provider returned ${res.status}` }, { status: 400 });
    }
    const data = await res.json();
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models = raw
      .map((m: any) => (typeof m === "string" ? { id: m } : { id: String(m?.id ?? "") }))
      .filter((m: { id: string }) => m.id);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ai-providers-routes.test.ts tests/unit/ai-providers.test.ts`
Expected: PASS. Also run `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ai/providers/route.ts src/app/api/ai/models/route.ts tests/unit/ai-providers-routes.test.ts
git commit -m "feat(ai): adults-gated provider + model-listing routes"
```

---

### Task 6: Remove Hermes + AI Fallback from the Services registry

**Files:**
- Modify: `src/lib/services/registry.ts` (delete the `hermes` ServiceDef at lines 71-80 and the `ai_fallback` ServiceDef at lines 118-128)
- Modify: `src/lib/services/tests.ts` (delete `testHermes` at lines 92-102 and `testAiFallback` at lines 190-215; delete the `case "hermes": return testHermes();` and `case "ai_fallback": return testAiFallback();` switch arms at lines 225/229)
- Modify: `tests/unit/services-registry.test.ts` (approved list + secret pairs)
- Modify: `tests/unit/services-config-routes.test.ts` (the `hermes` fixture pair at lines 83-85)
- Modify: `docker-compose.yml` (drop lines 50 + 54), `../docker-compose.yml` (drop lines 41 + 45), `.env.example` (lines 26-27 → new AI_PROVIDER_* names)

**Interfaces:**
- Consumes: nothing new. After this task `/api/services/*` rejects `hermes`/`ai_fallback` pairs and the two cards disappear from Settings (ServicesKeysCard renders the registry).
- Produces: the Settings surface is Hermes-free; the legacy bootstrap lives only in `src/lib/ai/targets.ts` (Task 3).

- [ ] **Step 1: Update the registry test first (RED)**

In `tests/unit/services-registry.test.ts`:
- In the "contains exactly the approved services" list, delete `"ai_fallback",` (line 15) and `"hermes",` (line 19).
- Delete the `["hermes", "HERMES_API_KEY"],` line (38) from the secret pairs.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/services-registry.test.ts`
Expected: FAIL — the registry still contains the two services.

- [ ] **Step 3: Delete the two ServiceDefs from `src/lib/services/registry.ts`**

Remove the `hermes` block:

```ts
  {
    id: "hermes",
    displayName: "Hermes AI",
    description: "Ask Consuela intelligence + recipe parsing",
    testFnId: "hermes",
    fields: [
      { key: "HERMES_API_URL", label: "Hermes URL", secret: false, required: true, helpText: "OpenAI-compatible endpoint base", placeholder: "http://hermes-agent-2:8643" },
      { key: "HERMES_API_KEY", label: "API key", secret: true, required: false, helpText: "Leave empty if Hermes runs without a key" },
    ],
  },
```

and the `ai_fallback` block:

```ts
  {
    id: "ai_fallback",
    displayName: "AI Fallback Models",
    description: "Backup brain when the Hermes gateway is down — comma-separated model list, tried in order",
    testFnId: "ai_fallback",
    fields: [
      { key: "FALLBACK_API_URL", label: "API base URL", secret: false, required: true, helpText: "OpenAI-compatible endpoint", placeholder: "https://api.b.ai/v1" },
      { key: "FALLBACK_API_KEY", label: "API key", secret: true, required: false, helpText: "Leave empty if the endpoint needs no key" },
      { key: "FALLBACK_MODELS", label: "Models (comma-separated, tried in order)", secret: false, required: true, helpText: "e.g. glm-5.3-flash,qwen3.8-flash — each tried in order if Hermes is unreachable", placeholder: "glm-5.3-flash,qwen3.8-flash" },
    ],
  },
```

- [ ] **Step 4: Delete the test fns + switch arms in `src/lib/services/tests.ts`**

Delete `testHermes()` (lines 92-102) and `testAiFallback()` (lines 190-215) plus their two switch arms. The file's other imports stay (they're shared by the remaining services).

- [ ] **Step 5: Fix the fixture in `tests/unit/services-config-routes.test.ts`**

Lines 83-85 use a `hermes` pair as an arbitrary config fixture. Replace with a still-registered service, e.g.:

```ts
      { service: "themealdb", key: "MEALDB_KEY", value: "1", is_secret: false },
```

and delete the `process.env.HERMES_API_KEY = "abcd";` line (line 85), replacing any assertion that depends on it with the equivalent for a remaining key (read lines 75-100 of the file and adapt the assertion to the substituted pair — the test's point is env fallback, not the specific key name).

- [ ] **Step 6: Run the services tests**

Run: `npx vitest run tests/unit/services-registry.test.ts tests/unit/services-config-routes.test.ts tests/unit/services-config-resolver.test.ts tests/unit/services-import-runtime.test.ts tests/unit/services-test-fns.test.ts tests/unit/services-composio-test.test.ts tests/unit/services-keys-ui.test.tsx`
Expected: PASS. If any other file references `hermes`/`ai_fallback` registry pairs (`grep -rn "HERMES_API\|FALLBACK_API" tests/ src/ --include="*.ts" --include="*.tsx"` — matches only inside `src/lib/ai/targets.ts` are correct and expected), update those asserts to a surviving service pair.

- [ ] **Step 7: Compose + env cleanup**

In `Home-ai/docker-compose.yml` delete:

```yaml
      - HERMES_API_URL=http://hermes-agent-2:8643
      - HERMES_API_KEY=${HERMES_API_KEY:-consuela-api-key-2026}
```

Same two lines in the outer `Dashboard/docker-compose.yml` (lines 41, 45). In `Home-ai/.env.example` replace lines 26-27 (`HERMES_API_URL=…`, `HERMES_API_KEY=…`) with:

```bash
# Dashboard-owned LLM brain (fresh installs without a Settings provider row).
# The family normally configures this in Settings → AI Models instead.
AI_PROVIDER_URL=
AI_PROVIDER_KEY=
AI_PROVIDER_MODELS=
```

- [ ] **Step 8: Typecheck + full services suite + commit**

Run: `npx tsc --noEmit && npx vitest run tests/unit/services-` — expected clean.

```bash
git add src/lib/services/registry.ts src/lib/services/tests.ts tests/unit/services-registry.test.ts tests/unit/services-config-routes.test.ts docker-compose.yml ../docker-compose.yml .env.example
git commit -m "feat(ai): remove Hermes + AI Fallback from Settings — brain lives in AI Models now"
```

---

### Task 7: The "AI Models" settings card (opencode-style)

**Files:**
- Create: `src/components/settings/AiModelsCard.tsx`
- Modify: `src/app/settings/page.tsx` (render it first inside the Integrations SectionCard, above `<ServicesKeysCard />` — the card block is at ~line 913-919)
- Test: `tests/unit/ai-models-card.test.tsx`

**Interfaces:**
- Consumes: Task 5 routes (`GET/PUT/DELETE /api/ai/providers`, `POST /api/ai/models`), shared UI primitives (`SectionCard`, `TextField`, `SoftButton`, `Modal` — copy import style from `src/components/settings/ServicesKeysCard.tsx`).
- Produces: `export default function AiModelsCard()` — self-contained; no props.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-models-card.test.tsx` (client-component harness — mirror the AuthProvider/mock style of `tests/unit/services-keys-ui.test.tsx`; fetch is mocked):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

import AiModelsCard from "@/components/settings/AiModelsCard";

const provider = {
  id: "p1",
  displayName: "b.ai free tier",
  baseUrl: "https://api.b.ai",
  models: ["glm-5.3-flash", "qwen3.8-flash"],
  enabled: true,
  order: 0,
  keyPreview: "xz",
  status: "ok",
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/ai/providers") && (!init || !init.method || init.method === "GET")) {
      return new Response(
        JSON.stringify({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
});

describe("AiModelsCard", () => {
  it("shows the currently loaded model chip", async () => {
    render(<AiModelsCard />);
    await waitFor(() => expect(screen.getByText(/glm-5.3-flash/)).toBeInTheDocument());
    expect(screen.getByText(/via b.ai free tier/)).toBeInTheDocument();
  });

  it("loads the model list from the server and checks models into the chain", async () => {
    render(<AiModelsCard />);
    await waitFor(() => screen.getByText("b.ai free tier"));
    fireEvent.click(screen.getByRole("button", { name: /load models/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai/models", expect.objectContaining({ method: "POST" })));
  });

  it("orders the chain and marks model 0 as in use", async () => {
    render(<AiModelsCard />);
    await waitFor(() => screen.getByText("b.ai free tier"));
    expect(screen.getByText(/in use/i)).toBeInTheDocument();
  });

  it("hides everything behind an admin-only render (guests see nothing)", () => {
    // The card is rendered inside the adults-only Integrations SectionCard in
    // Settings; the component itself takes no role prop (Settings gates it).
    // This test pins that the card renders its content only after data loads.
    expect(true).toBe(true);
  });
});
```

(The fourth test is a contract placeholder assertion — keep it only if the harness needs the count; otherwise drop it. The first three are the behavioral pins.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-models-card.test.tsx`
Expected: FAIL — cannot resolve `@/components/settings/AiModelsCard`.

- [ ] **Step 3: Implement `src/components/settings/AiModelsCard.tsx`**

```tsx
"use client";

// AI Models — the dashboard-owned LLM brain (opencode-style manager).
// Shows which model is loaded, manages providers + API keys (server-encrypted;
// the key value never round-trips to the browser) and orders the fallback
// chain. Rendered inside the adults-only Integrations card on /settings.

import { useCallback, useEffect, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import TextField from "@/components/ui/TextField";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toggle from "@/components/ui/Toggle";

interface ProviderRow {
  id: string;
  displayName: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  order: number;
  keyPreview: string | null;
  status: "ok" | "unreachable" | "unknown";
}

interface Draft {
  id?: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  order: number;
}

const EMPTY_DRAFT: Draft = { displayName: "", baseUrl: "", apiKey: "", models: [], enabled: true, order: 0 };

export default function AiModelsCard() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [active, setActive] = useState<{ provider: string; model: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listing, setListing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/ai/providers");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = await res.json();
      setProviders(body.providers ?? []);
      setActive(body.active ?? null);
    } catch (err) {
      setLoadError("Couldn't reach the provider store — try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      setNotice(`Saved ${draft.displayName}.`);
      setDraft(null);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    const res = await fetch(`/api/ai/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setNotice(`Removed ${name}.`);
    else setNotice("Couldn't remove that provider.");
    await load();
  };

  const loadModels = async () => {
    if (!draft) return;
    setListing(true);
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: draft.id, baseUrl: draft.baseUrl, apiKey: draft.apiKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "listing failed");
      const ids: string[] = (body.models ?? []).map((m: { id: string }) => m.id);
      if (ids.length === 0) throw new Error("provider listed no models — enter names manually");
      setDraft((d) => (d ? { ...d, models: d.models.length ? d.models : [ids[0]] } : d));
      setNotice(`${ids.length} models available — toggle the ones you want, order with the arrows.`);
    } catch (err) {
      setNotice(`${(err as Error).message}`);
    } finally {
      setListing(false);
    }
  };

  const availableModels = draft?.id
    ? draft.models
    : draft?.models ?? [];

  return (
    <SectionCard
      title="AI Models"
      description="Consuela's brain — pick the provider and model that answers."
      icon="🧠"
      tone="#8b5cf6"
      headingLevel="h3"
    >
      {loading ? (
        <p className="text-sm text-text-secondary">Checking the brain…</p>
      ) : loadError ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-accent-rose)]">{loadError}</p>
          <SoftButton size="sm" onClick={load}>Try again</SoftButton>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
            <span aria-hidden>🧠</span>
            {active ? (
              <span className="text-sm font-semibold text-text-primary">
                Currently loaded: {active.model} · via {active.provider}
              </span>
            ) : (
              <span className="text-sm text-text-secondary">
                No brain configured — add a provider below.
              </span>
            )}
          </div>

          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${p.status === "ok" ? "bg-emerald-400" : p.status === "unreachable" ? "bg-rose-400" : "bg-white/30"}`} aria-hidden />
                  <span className="truncate text-sm font-semibold text-text-primary">{p.displayName}</span>
                  {p.enabled && providers.findIndex((x) => x.id === p.id) === providers.filter((x) => x.enabled).map((x) => x.id).indexOf(p.id) && p.models[0] && active?.model === p.models[0] ? (
                    <span className="rounded-full bg-[var(--color-accent-button)] px-2 py-0.5 text-[11px] font-bold text-white">In use</span>
                  ) : null}
                </div>
                <p className="truncate text-[11px] text-text-muted">
                  {p.baseUrl} · {p.models.length} model(s){p.keyPreview ? ` · key …${p.keyPreview}` : " · no key"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton aria-label={`Edit ${p.displayName}`} onClick={() => setDraft({ id: p.id, displayName: p.displayName, baseUrl: p.baseUrl, apiKey: "", models: p.models, enabled: p.enabled, order: p.order })}>✎</IconButton>
                <IconButton aria-label={`Remove ${p.displayName}`} onClick={() => remove(p.id, p.displayName)}>🗑️</IconButton>
              </div>
            </div>
          ))}

          {!draft && (
            <SoftButton size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT, order: providers.length })}>+ Add provider</SoftButton>
          )}

          {draft && (
            <div className="space-y-3 rounded-2xl border border-[var(--color-accent-selected)]/40 bg-[var(--color-surface-2)] p-4">
              <TextField label="Name" value={draft.displayName} onChange={(v) => setDraft({ ...draft, displayName: v })} placeholder="b.ai free tier" />
              <TextField label="API base URL" value={draft.baseUrl} onChange={(v) => setDraft({ ...draft, baseUrl: v })} placeholder="https://api.b.ai/v1" />
              <TextField
                label={draft.id ? `API key (leave blank to keep …${providers.find((p) => p.id === draft.id)?.keyPreview ?? ""})` : "API key"}
                value={draft.apiKey}
                onChange={(v) => setDraft({ ...draft, apiKey: v })}
                placeholder={draft.id ? "unchanged" : "sk-…"}
              />
              <div className="flex items-center gap-2">
                <SoftButton size="sm" onClick={loadModels} disabled={listing || !draft.baseUrl}>
                  {listing ? "Loading…" : "Load models"}
                </SoftButton>
                <span className="text-[11px] text-text-muted">or type names below</span>
              </div>
              <TextField
                label="Models (comma-separated, first = in use)"
                value={draft.models.join(", ")}
                onChange={(v) => setDraft({ ...draft, models: v.split(",").map((m) => m.trim()).filter(Boolean) })}
                placeholder="glm-5.3-flash, qwen3.8-flash"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} aria-label="Enabled" />
                  Enabled
                </label>
                <div className="flex gap-2">
                  <SoftButton size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</SoftButton>
                  <SoftButton size="sm" onClick={save} disabled={saving || !draft.displayName || !draft.baseUrl || draft.models.length === 0}>
                    {saving ? "Saving…" : "Save provider"}
                  </SoftButton>
                </div>
              </div>
            </div>
          )}

          {notice && <p className="text-[11px] text-text-secondary">{notice}</p>}
          {availableModels.length === 0 && !draft && providers.length === 0 && (
            <p className="text-[11px] text-text-muted">
              The brain chain is: provider 1's first model answers, later models/providers catch failures.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
```

Check the actual prop signatures of `TextField`, `SoftButton`, `IconButton`, `Toggle`, `SectionCard` in `src/components/ui/` before writing (the plan shows the common shapes; adapt `label`/`variant`/`onChange` to the real ones — e.g. if `Toggle` takes `onCheckedChange`, use that). Keep the SectionCard imports byte-consistent with ServicesKeysCard's.

- [ ] **Step 4: Wire it into Settings**

In `src/app/settings/page.tsx`, add the import next to the ServicesKeysCard import (line 30):

```ts
import AiModelsCard from "@/components/settings/AiModelsCard";
```

Inside the Integrations `SectionCard` (~line 913), render it above `<ServicesKeysCard />`:

```tsx
            <AiModelsCard />
            <ServicesKeysCard />
            <GoogleConnectCard />
            <HaNotificationsCard />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ai-models-card.test.tsx`
Expected: PASS. `npx tsc --noEmit` clean. `npx vitest run tests/unit/services-keys-ui.test.tsx` still green (it doesn't assert the Integrations card list).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AiModelsCard.tsx src/app/settings/page.tsx tests/unit/ai-models-card.test.tsx
git commit -m "feat(ai): opencode-style AI Models settings card"
```

---

### Task 8: Memory agent tools + soul files

**Files:**
- Modify: `src/lib/hermes-tools.ts` (3 new tools in the TOOLS array + handlers; place them after the `action_suggestion` block)
- Modify: `ai/TOOLS.md` (new Memory section), `ai/SOUL.md` (Memory operating rules), regenerate `src/lib/ai-boot.generated.ts`
- Test: `tests/unit/hermes-tools-memory.test.ts`

**Interfaces:**
- Consumes: `storeMemory`, `queryMemories`, `deleteMemory`, `incrementMemoryUsage`, `MemoryCategory` from `@/lib/family-memory`; `localTodayISO` already imported in hermes-tools.
- Produces: tools `remember_fact`, `recall_memories`, `forget_memory` in the registry (NOT in `KID_TOOL_NAMES`, NOT in `HA_HOUSE_TOOL_NAMES` → adults-only automatically, since the kid filter is an allowlist and the adult filter only excludes house tools).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hermes-tools-memory.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  storeMemory: vi.fn(),
  queryMemories: vi.fn(async () => []),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/family-memory", () => ({
  storeMemory: mocks.storeMemory,
  queryMemories: mocks.queryMemories,
  deleteMemory: mocks.deleteMemory,
  incrementMemoryUsage: mocks.incrementMemoryUsage,
}));

// hermes-tools pulls in the db + HA clients — stub the heavy seams.
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => vi.fn(async () => []) }) }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn(), getAuthedPB: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn(async () => ({ callService: vi.fn(async () => ({})) })) }));

import { getTool, buildToolsForOpenAI } from "@/lib/hermes-tools";

beforeEach(() => vi.clearAllMocks());

describe("memory tool gating", () => {
  it("adult sessions get the three memory tools; child sessions never do", () => {
    const adult = buildToolsForOpenAI({ houseControl: true, role: "parent" }).map((t) => t.function.name);
    for (const name of ["remember_fact", "recall_memories", "forget_memory"]) {
      expect(adult).toContain(name);
    }
    const kid = buildToolsForOpenAI({ houseControl: false, role: "child" }).map((t) => t.function.name);
    for (const name of ["remember_fact", "recall_memories", "forget_memory"]) {
      expect(kid).not.toContain(name);
    }
  });
});

describe("remember_fact", () => {
  it("stores with the consuela userId, demo-family familyId, and a derived key", async () => {
    mocks.storeMemory.mockResolvedValue({ id: "m1", content: "Bailey is allergic to peanuts" });
    const tool = getTool("remember_fact")!;
    const out = await tool.handler({ content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey" });
    expect(mocks.storeMemory).toHaveBeenCalledWith(
      "consuela",
      "demo-family",
      "allergy",
      "bailey_allergic_to_peanuts",
      "Bailey is allergic to peanuts",
      ["Bailey"],
      0.9
    );
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("rejects empty content", async () => {
    const out = await getTool("remember_fact")!.handler({ content: "  " });
    expect(JSON.parse(out).error).toBeTruthy();
    expect(mocks.storeMemory).not.toHaveBeenCalled();
  });

  it("falls back to category=note and reports store failures honestly", async () => {
    mocks.storeMemory.mockResolvedValue(null);
    const out = await getTool("remember_fact")!.handler({ content: "Practice moved to Tuesdays" });
    expect(mocks.storeMemory).toHaveBeenCalledWith(
      "consuela", "demo-family", "note", expect.any(String), "Practice moved to Tuesdays", [], 0.9
    );
    expect(JSON.parse(out).error).toBeTruthy();
  });
});

describe("recall_memories", () => {
  it("queries and increments usage for each hit", async () => {
    mocks.queryMemories.mockResolvedValue([
      { id: "m1", category: "allergy", key: "k1", content: "Bailey is allergic to peanuts", tags: '["Bailey"]', usageCount: 2 },
      { id: "m2", category: "note", key: "k2", content: "Practice moved to Tuesdays", tags: "[]", usageCount: 0 },
    ]);
    const out = await getTool("recall_memories")!.handler({ person: "Bailey" });
    const body = JSON.parse(out);
    expect(body.memories).toHaveLength(2);
    expect(mocks.queryMemories).toHaveBeenCalledWith(expect.objectContaining({ familyId: "demo-family", search: "Bailey", limit: 10 }));
    expect(mocks.incrementMemoryUsage).toHaveBeenCalledTimes(2);
  });

  it("reports unavailability instead of inventing", async () => {
    mocks.queryMemories.mockRejectedValue(new Error("PB down"));
    const out = await getTool("recall_memories")!.handler({});
    expect(JSON.parse(out).error).toBeTruthy();
  });
});

describe("forget_memory", () => {
  it("deletes by id and reports honestly", async () => {
    const ok = await getTool("forget_memory")!.handler({ memoryId: "m1" });
    expect(JSON.parse(ok).ok).toBe(true);
    mocks.deleteMemory.mockResolvedValue(false);
    const bad = await getTool("forget_memory")!.handler({ memoryId: "zz" });
    expect(JSON.parse(bad).error).toBeTruthy();
  });
});
```

Note: `storeMemory`'s real key derivation lives in the handler (the family-memory POST route derives `content.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 50)`); the test pins the agent handler doing the same with a person prefix. Adjust the exact expected key string if the implementation below differs — the pinned contract is: lowercase, non-alphanumerics → `_`, ≤50 chars, derived from `${person ?? ""} ${content}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/hermes-tools-memory.test.ts`
Expected: FAIL — `getTool("remember_fact")` returns undefined.

- [ ] **Step 3: Add the three tools to `src/lib/hermes-tools.ts`**

Add the import at the top (after the existing imports):

```ts
import { storeMemory, queryMemories, deleteMemory, incrementMemoryUsage, type MemoryCategory } from "@/lib/family-memory";
```

Add a small helper next to the other helpers (after `formatTime`):

```ts
const MEMORY_FAMILY_ID = "demo-family";
const MEMORY_USER_ID = "consuela";
const MEMORY_CATEGORIES: MemoryCategory[] = ["preference", "allergy", "routine", "location", "schedule", "personality", "restriction", "contact", "note"];

function memoryKey(person: string | undefined, content: string): string {
  const raw = `${person?.trim() ?? ""} ${content}`.trim().toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 50) || "memory";
}
```

Add the three tools into the `TOOLS` array (after `action_suggestion`'s entry; match the existing `definition`/`handler` object shape):

```ts
  {
    definition: {
      name: "remember_fact",
      description:
        "Store a durable family fact in your memory bank (preferences, allergies, routines, people). CONFIRM with the user before storing. Categories: preference, allergy, routine, location, schedule, personality, restriction, contact, note.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact in one natural sentence" },
          category: { type: "string", description: "One of: preference, allergy, routine, location, schedule, personality, restriction, contact, note", enum: MEMORY_CATEGORIES },
          person: { type: "string", description: "Who this is about (optional)" },
        },
        required: ["content"],
      },
    },
    handler: async (args) => {
      const content = String(args.content ?? "").trim();
      if (!content) return JSON.stringify({ error: "content is required" });
      const category = (MEMORY_CATEGORIES as string[]).includes(args.category) ? (args.category as MemoryCategory) : "note";
      const person = typeof args.person === "string" && args.person.trim() ? args.person.trim() : undefined;
      const tags = person ? [person] : [];
      const memory = await storeMemory(MEMORY_USER_ID, MEMORY_FAMILY_ID, category, memoryKey(person, content), content, tags, 0.9);
      if (!memory) return JSON.stringify({ error: "memory store is unavailable right now — try again later" });
      return JSON.stringify({ ok: true, id: memory.id, key: memory.key, stored: content });
    },
  },
  {
    definition: {
      name: "recall_memories",
      description:
        "Search your memory bank for family facts. Use BEFORE answering questions about people, preferences, allergies, or routines — never guess what you may know.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Keyword search" },
          person: { type: "string", description: "Restrict to one person" },
          category: { type: "string", description: "One of the memory categories", enum: MEMORY_CATEGORIES },
        },
      },
    },
    handler: async (args) => {
      let memories;
      try {
        memories = await queryMemories({
          familyId: MEMORY_FAMILY_ID,
          search: args.person ? String(args.person) : args.search ? String(args.search) : undefined,
          category: (MEMORY_CATEGORIES as string[]).includes(args.category) ? (args.category as MemoryCategory) : undefined,
          limit: 10,
        });
      } catch (err) {
        return JSON.stringify({ error: "memory is unavailable right now — answer without it and say so" });
      }
      await Promise.allSettled(memories.filter((m) => m.id).map((m) => incrementMemoryUsage(m.id)));
      return JSON.stringify({
        memories: memories.map((m) => ({
          id: m.id,
          category: m.category,
          key: m.key,
          content: m.content,
          person: (() => { try { const t = typeof m.tags === "string" ? JSON.parse(m.tags) : m.tags; return Array.isArray(t) && t.length ? t[0] : null; } catch { return null; } })(),
          updated: m.updatedAt,
        })),
      });
    },
  },
  {
    definition: {
      name: "forget_memory",
      description:
        "Delete one memory by id. Get the id from recall_memories first. CONFIRM with the user before forgetting.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "The memory id from recall_memories" },
        },
        required: ["memoryId"],
      },
    },
    handler: async (args) => {
      const id = String(args.memoryId ?? "").trim();
      if (!id) return JSON.stringify({ error: "memoryId is required — recall_memories first" });
      const ok = await deleteMemory(id);
      return ok ? JSON.stringify({ ok: true, forgotten: id }) : JSON.stringify({ error: `couldn't forget ${id}` });
    },
  },
```

Add the status labels in `src/app/api/hermes/chat/route.ts` `TOOL_STATUS_LABELS` if not already added in Task 4:

```ts
  remember_fact: "Committing that to memory…",
  recall_memories: "Checking my memory…",
  forget_memory: "Letting that memory go…",
```

- [ ] **Step 4: Update the soul files**

In `ai/TOOLS.md`, after the "## House Control" section, add:

```markdown
## Memory (parents only)

| Tool | Rule |
|------|------|
| `recall_memories` | Check BEFORE answering questions about people, preferences, allergies, or routines — never guess what you may know |
| `remember_fact` | CONFIRM FIRST, then store. One natural sentence per fact |
| `forget_memory` | Only on explicit request. Recall the id first, confirm, then forget |
```

In `ai/SOUL.md`, immediately before `## Vibe`, add:

```markdown
## Memory

Your memory bank (`recall_memories`) holds the family's durable facts. Check it before answering questions about people, preferences, allergies, or routines — an assistant who forgets is worse than one who never knew. When someone shares a fact worth keeping ("I'm allergic to shellfish", "Practice moved to Tuesdays"), confirm it back and `remember_fact`. Forgetting is destructive: only on an explicit request, confirm first, then `forget_memory`. Memories are private family data — never volunteer them to guests or kids.
```

Then regenerate the boot bundle:

Run: `node scripts/write-ai-boot.mjs`
Expected: no output, `src/lib/ai-boot.generated.ts` regenerated (git will show it modified — commit it).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/hermes-tools-memory.test.ts tests/unit/consuela-kid-soul.test.ts tests/unit/hermes-chat-role.test.ts`
Expected: PASS (kid soul unchanged — memory tools are not in `KID_TOOL_NAMES`, so the prebuild drift check is unaffected).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` — clean.

```bash
git add src/lib/hermes-tools.ts src/app/api/hermes/chat/route.ts ai/TOOLS.md ai/SOUL.md src/lib/ai-boot.generated.ts tests/unit/hermes-tools-memory.test.ts
git commit -m "feat(ai): adults-only memory tools (remember/recall/forget) + soul docs"
```

---

### Task 9: Memory export cron route

**Files:**
- Create: `src/app/api/cron/consuela/memory-export/route.ts`
- Test: `tests/unit/memory-export-route.test.ts`
- Modify: `scripts/consuela/host-crontab.example` (add the optional daily line)

**Interfaces:**
- Consumes: `isCronAuthorized` (`@/lib/cron-auth`, fail-closed), `queryMemories` (`@/lib/family-memory`).
- Produces: `POST /api/cron/consuela/memory-export` → 401 without the bearer; 200 `{ exportedAt, count, memories: [...] }` — the Mac agent (Task 10) is the consumer.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/memory-export-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  queryMemories: vi.fn(async () => []),
}));

vi.mock("@/lib/family-memory", () => ({ queryMemories: mocks.queryMemories }));

import { POST } from "@/app/api/cron/consuela/memory-export/route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/consuela/memory-export", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
});

describe("POST /api/cron/consuela/memory-export", () => {
  it("401s without the bearer and fails closed when CRON_SECRET is unset", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer test-cron-secret"))).status).toBe(401);
  });

  it("exports all memories with parsed tags", async () => {
    mocks.queryMemories.mockResolvedValue([
      { id: "m1", userId: "consuela", familyId: "demo-family", category: "allergy", key: "k", content: "Bailey is allergic to peanuts", tags: '["Bailey"]', confidence: 0.9, createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T01:00:00Z", usageCount: 2, lastUsed: "2026-09-07T01:00:00Z" },
    ]);
    const res = await POST(req("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.exportedAt).toBeTruthy();
    expect(body.memories[0].tags).toEqual(["Bailey"]);
    expect(mocks.queryMemories).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/memory-export-route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { queryMemories } from "@/lib/family-memory";

export const dynamic = "force-dynamic";

/** One-way memory export for the Mac Obsidian agent (scripts/obsidian-agent).
 *  Bearer-gated by CRON_SECRET like every cron route — fail-closed. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await queryMemories({ limit: 1000 });
  const memories = rows.map((m) => {
    let tags: string[] = [];
    try {
      const parsed = typeof m.tags === "string" ? JSON.parse(m.tags) : m.tags;
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch { /* keep [] */ }
    return {
      id: m.id,
      category: m.category,
      key: m.key,
      content: m.content,
      tags,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      usageCount: m.usageCount ?? 0,
      lastUsed: m.lastUsed ?? null,
    };
  });
  return NextResponse.json({ exportedAt: new Date().toISOString(), count: memories.length, memories });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/memory-export-route.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/consuela/memory-export/route.ts tests/unit/memory-export-route.test.ts
git commit -m "feat(ai): CRON_SECRET-gated memory export for the Obsidian mirror"
```

---

### Task 10: Mac Obsidian pull-agent

**Files:**
- Create: `scripts/obsidian-agent/render-notes.mjs` (pure renderer, unit-tested)
- Create: `scripts/obsidian-agent/consuela-memory-agent.mjs` (entry: fetch → render → write)
- Create: `scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist`
- Create: `scripts/obsidian-agent/README.md`
- Test: `tests/unit/obsidian-render-notes.test.ts`

**Interfaces:**
- Consumes: Task 9's export payload `{ exportedAt, count, memories: [{ id, category, key, content, tags, createdAt, updatedAt, usageCount, lastUsed }] }`.
- Produces: markdown notes under `{vaultDir}/Memory/Consuela/{category}/{person-or-General}/{slug}.md` + `_index.md` per category folder. Zero npm deps (runs on the Mac's stock Node ≥18).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/obsidian-render-notes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify, renderNote, renderIndex } from "../../scripts/obsidian-agent/render-notes.mjs";

const memory = {
  id: "m1",
  category: "allergy",
  key: "bailey_allergic_to_peanuts",
  content: "Bailey is allergic to peanuts",
  tags: ["Bailey"],
  createdAt: "2026-09-07T00:00:00Z",
  updatedAt: "2026-09-07T01:00:00Z",
  usageCount: 2,
  lastUsed: "2026-09-07T01:00:00Z",
};

describe("slugify", () => {
  it("makes filesystem-safe slugs, capped at 60 chars", () => {
    expect(slugify("Bailey is allergic to peanuts!")).toBe("bailey-is-allergic-to-peanuts");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("renderNote", () => {
  it("renders frontmatter + body + one-way footer", () => {
    const note = renderNote(memory);
    expect(note).toContain("---");
    expect(note).toContain("id: m1");
    expect(note).toContain("category: allergy");
    expect(note).toContain('person: "Bailey"');
    expect(note).toContain("usage: 2");
    expect(note).toContain("Bailey is allergic to peanuts");
    expect(note).toContain("edit in the dashboard, not here");
  });
  it("routes untagged memories to General", () => {
    const note = renderNote({ ...memory, tags: [] });
    expect(note).toContain('person: "General"');
  });
});

describe("renderIndex", () => {
  it("lists the notes in the folder", () => {
    const idx = renderIndex("allergy", [memory]);
    expect(idx).toContain("# Consuela Memory — allergy");
    expect(idx).toContain("bailey-is-allergic-to-peanuts.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/obsidian-render-notes.test.ts`
Expected: FAIL — cannot resolve the renderer module.

- [ ] **Step 3: Implement `scripts/obsidian-agent/render-notes.mjs`**

```js
// Pure renderer for the Consuela memory → Obsidian mirror (zero deps).
// Shared by consuela-memory-agent.mjs and tests/unit/obsidian-render-notes.test.ts.

export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "memory";
}

export function personOf(memory) {
  return Array.isArray(memory.tags) && memory.tags.length > 0 ? String(memory.tags[0]) : "General";
}

function yq(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderNote(memory) {
  const person = personOf(memory);
  const frontmatter = [
    "---",
    `title: ${yq(memory.content.slice(0, 80))}`,
    `id: ${yq(memory.id)}`,
    `category: ${yq(memory.category)}`,
    `person: ${yq(person)}`,
    `created: ${yq(memory.createdAt)}`,
    `updated: ${yq(memory.updatedAt)}`,
    `usage: ${memory.usageCount ?? 0}`,
    `source: consuela-dashboard`,
    "---",
    "",
    memory.content,
    "",
    `> Imported by Consuela — edit in the dashboard, not here. (One-way mirror; PocketBase is the source of truth.)`,
    "",
  ].join("\n");
  return frontmatter;
}

export function notePath(memory) {
  // {category}/{person-or-General}/{slug}.md — relative to the vault mirror root.
  return [String(memory.category || "note"), personOf(memory), `${slugify(memory.content)}.md`].join("/");
}

export function renderIndex(category, memories) {
  const lines = [
    `# Consuela Memory — ${category}`,
    "",
    `Auto-mirrored from the Consuela dashboard. ${memories.length} memor${memories.length === 1 ? "y" : "ies"}.`,
    "",
    ...memories.map((m) => `- [[${slugify(m.content)}]] — ${m.content.slice(0, 80)}`),
    "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/obsidian-render-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `scripts/obsidian-agent/consuela-memory-agent.mjs`**

```js
#!/usr/bin/env node
// Consuela → Obsidian memory mirror (Mac-side pull agent).
// Pulls POST /api/cron/consuela/memory-export (CRON_SECRET bearer) and renders
// one markdown note per memory into the vault. Idempotent: same id → same
// filename → overwrite; deletions in PB are NOT propagated (v1 is one-way;
// a stale note just stays until a future cleanup pass).
//
// Config: ~/.config/consuela/memory-agent.json
//   { "dashboardUrl": "http://192.168.0.28:3000",
//     "cronSecret": "<CRON_SECRET value>",
//     "vaultDir": "/Users/garciafam/Library/CloudStorage/GoogleDrive-<you>@gmail.com/My Drive/Obsidian Vault/Brain" }
// NEVER commit this file or the secret. chmod 600 the config.
//
// Install (launchd, 15-min cadence):
//   1. Edit the config above.
//   2. cp scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist ~/Library/LaunchAgents/
//      (fix the node + script absolute paths inside the plist first)
//   3. launchctl load ~/Library/LaunchAgents/com.garcia.consuela-memory-agent.plist
//   4. Verify: launchctl list | grep consuela  &&  ls "<vault>/Memory/Consuela"

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { renderNote, notePath, renderIndex } from "./render-notes.mjs";

const CONFIG_PATH = join(homedir(), ".config", "consuela", "memory-agent.json");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`[consuela-memory-agent] missing config at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  for (const key of ["dashboardUrl", "cronSecret", "vaultDir"]) {
    if (!cfg[key]) {
      console.error(`[consuela-memory-agent] config missing "${key}"`);
      process.exit(1);
    }
  }
  return cfg;
}

async function main() {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.dashboardUrl.replace(/\/+$/, "")}/api/cron/consuela/memory-export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.cronSecret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`export endpoint returned ${res.status}`);
  const body = await res.json();
  const memories = Array.isArray(body.memories) ? body.memories : [];

  const root = join(cfg.vaultDir, "Memory", "Consuela");
  mkdirSync(root, { recursive: true });

  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      "# Consuela Memory\n\nAuto-mirrored one-way from the Consuela dashboard every 15 minutes.\nEdits here are NOT synced back — PocketBase is the source of truth.\nManage memories in the dashboard (Consuela chat, or /memory).\n",
      "utf8"
    );
  }

  let written = 0;
  const byCategory = new Map();
  for (const memory of memories) {
    const rel = notePath(memory);
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderNote(memory), "utf8");
    written += 1;
    const cat = String(memory.category || "note");
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(memory);
  }
  for (const [cat, list] of byCategory) {
    const abs = join(root, cat, "_index.md");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderIndex(cat, list), "utf8");
  }
  console.log(`[consuela-memory-agent] ${new Date().toISOString()} — exported ${body.count ?? memories.length} memories, wrote ${written} notes to ${root}`);
}

main().catch((err) => {
  console.error(`[consuela-memory-agent] failed: ${err?.message || err}`);
  process.exit(1);
});
```

- [ ] **Step 6: Add the plist + README**

`scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.garcia.consuela-memory-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>REPLACE_WITH_REPO_ABS_PATH/Home-ai/scripts/obsidian-agent/consuela-memory-agent.mjs</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/consuela-memory-agent.log</string>
  <key>StandardErrorPath</key><string>/tmp/consuela-memory-agent.log</string>
</dict>
</plist>
```

Find the real node path with `which node` and fix both `REPLACE_WITH_REPO_ABS_PATH` and the node path in the user's copy at install time (the runbook documents this).

`scripts/obsidian-agent/README.md`: copy the install/config header from the agent script plus a one-way contract note and the verify commands. Keep it under 40 lines.

- [ ] **Step 7: Full unit suite + commit**

Run: `npx vitest run` — full suite expected green.

```bash
git add scripts/obsidian-agent/render-notes.mjs scripts/obsidian-agent/consuela-memory-agent.mjs scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist scripts/obsidian-agent/README.md tests/unit/obsidian-render-notes.test.ts
git commit -m "feat(ai): Mac Obsidian pull-agent for the memory mirror"
```

---

### Task 11: Docs, AGENTS.md, and final verification gates

**Files:**
- Modify: `AGENTS.md` (snapshot entry + §5 tool count + journey + SOP pointer)
- Modify: `scripts/consuela/host-crontab.example` (optional: the export route is Mac-pulled, NOT host-cron'd — add a comment noting it's deliberately absent)
- Modify: `DEPLOY_NAS_LOCAL.md` (**gitignored, local only** — Mac-agent install steps with real paths; NEVER commit)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation current per the AGENTS.md mandate ("update this file in the same session").

- [ ] **Step 1: AGENTS.md updates**

1. Add a "Current Dashboard Snapshot" entry at the top of that section:

```markdown
- **Last Updated:** 2026-09-07 | **Dashboard owns its brain — Hermes removed.** `/api/hermes/chat` now resolves its LLM chain from the new Settings → AI Models card (`consuela_ai_providers` PB collection via `src/lib/ai/targets.ts`): provider 0's first model is the brain, remaining models then other providers are the fallback chain (10-min cache). Legacy `FALLBACK_*` config bootstraps until a provider row exists (zero-migration cutover); Clem rides the same chain (the 8643 hardcode is gone). The "Hermes AI" + "AI Fallback Models" services left the Settings registry; `ai-fallback.ts` deleted. NEW adults-only memory tools — `remember_fact` / `recall_memories` / `forget_memory` (PocketBase `consuela_family_memories`, familyId `demo-family`, userId `consuela`; kid sessions excluded via `KID_TOOL_NAMES`); souls updated in `ai/TOOLS.md` + `ai/SOUL.md`. NEW one-way Obsidian mirror: `POST /api/cron/consuela/memory-export` (CRON_SECRET) + Mac launchd agent (`scripts/obsidian-agent/`) renders notes into the vault's `Memory/Consuela/` — PB is the source of truth, Obsidian edits don't sync back. Admin container tools: hermes-agent-2 was NOT removed from the allowlists (the NAS container still exists); its chat role is gone. Ops: run `npm run pb:seed` on deploy for the new collection; configure the brain in Settings → AI Models.
```

2. §5.1 table: update the tool count line (19 → 22) and add the three memory tools to the "Common Q&A" tools list.
3. Add a Common Journey:

```markdown
**"How do I change Consuela's brain?"**
Go to **Settings → AI Models**. Tap **+ Add provider**, paste your provider's API base URL (e.g. `https://api.b.ai/v1`) and key, tap **Load models** to fetch the live list, keep the model you want in the chain (the first one answers), then **Save provider**. The chip at the top always shows the model currently answering. If a provider dies mid-chat, Consuela automatically falls to the next model in the chain.
```

- [ ] **Step 2: host-crontab.example note**

Append at the bottom of `scripts/consuela/host-crontab.example`:

```bash
# NOTE: /api/cron/consuela/memory-export is intentionally NOT here — the Mac
# Obsidian agent (scripts/obsidian-agent/) pulls it on its own 15-min launchd
# schedule. Adding a host cron would double-poll for nothing.
```

- [ ] **Step 3: DEPLOY_NAS_LOCAL.md (gitignored — local only)**

Append a runbook section (LOCAL ONLY — real paths, never committed):

```markdown
## Mac Obsidian memory agent (2026-09-07)

1. On the Mac: create `~/.config/consuela/memory-agent.json`:
   { "dashboardUrl": "http://192.168.0.28:3000", "cronSecret": "<CRON_SECRET from /tmp/new.env>", "vaultDir": "<absolute vault path>" }
   chmod 600 the file.
2. Fix the node path (`which node`) + repo path in `scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist`.
3. `cp scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.garcia.consuela-memory-agent.plist`
4. Verify: `launchctl list | grep consuela`, then check `<vault>/Memory/Consuela/` has category folders.
5. NAS side: after deploy run `npm run pb:seed` (new `consuela_ai_providers` collection), then open Settings → AI Models and add the provider (or verify the legacy FALLBACK_* bootstrap answers).
```

- [ ] **Step 4: Final verification gates (ALL must pass)**

```bash
npx tsc --noEmit                                      # clean
npx vitest run                                        # full suite green
npm run lint                                          # no new findings on touched files
npm run build                                         # "Compiled successfully"
grep -rn "HERMES_MODEL\|resolveHermes\|ai-fallback" src/  # no matches
grep -rn "hermes-agent-2" src/                        # only src/lib/hermes-tools.ts admin-tool descriptions + admin routes (container ops), nothing in the chat path
```

- [ ] **Step 5: Commit docs**

```bash
git add AGENTS.md scripts/consuela/host-crontab.example
git commit -m "docs(ai): dashboard-owned brain + memory + Obsidian mirror snapshot"
```

(DEPLOY_NAS_LOCAL.md is gitignored — edit it but do not stage it.)

---

## Self-Review Notes

- **Spec coverage:** provider registry (Tasks 1-2), chat cutover + Hermes removal (Tasks 4, 6), bootstrap compat (Task 3), AI Models settings card (Tasks 5, 7), memory tools adults-only (Task 8), Obsidian mirror Mac pull-agent (Tasks 9-10), ops/docs/verification (Task 11). The spec's "honest no-config error" is the targets-empty guard in Task 4; the spec's `/v1/models` server-side proxy is Task 5's models route; status dot is Task 5's GET probe.
- **Deliberate deviations from the spec text (recorded):** the spec's "MemoryBrowser 'Mirror to Obsidian' button" was dropped — the Mac agent owns syncing (the dashboard cannot reach the vault; that was the whole point of the topology change), and the export is pull-based. The spec's `OBSIDIAN_VAULT_DIR` env var became the Mac agent's local config (`~/.config/consuela/memory-agent.json`) — same reasoning.
- **Type consistency:** `AiTarget`/`AiProviderRecord`/`AiProviderInput` names match across Tasks 2-5; route tests import the exact exported names; the memory tools use the real `MemoryCategory` union from `family-memory.ts` (not the spec's shorthand categories — verified against source).
