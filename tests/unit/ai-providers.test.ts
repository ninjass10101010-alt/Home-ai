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
function fakePb(rows: any[] = []) {
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
      { id: "off", displayName: "Off", baseUrl: "https://o", apiKey: null, models: '["om"]', enabled: false, order: 3 },
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
