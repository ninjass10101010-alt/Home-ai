// src/db/features/migrate.ts — the two spec §6.1 fixes:
//  1. `createCollection` used to return a boolean, so a FAILED create fell
//     through to `skipped` and the CLI could never exit non-zero. It now
//     returns "created" | "skipped" | "failed" and the tally feeds
//     `main()`'s existing `result.failed > 0` exit.
//  2. `reconcileFileFieldLimits` — editing a schema changes nothing on an
//     EXISTING collection, so the bumped `maxSize` is written back in the
//     shape it was read (PB <0.23 nested options, ≥0.23 flat).
//
// The PB seam is a fake object and the health-check `fetch` is stubbed, so
// nothing here can reach a live PocketBase.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminPB: vi.fn(),
}));

vi.mock("@/lib/pb", () => ({
  getAdminPB: () => mocks.getAdminPB(),
}));

import { runFeatureMigration, reconcileFileFieldLimits } from "@/db/features/migrate";
import { photosSchema } from "@/db/features/photos";
import { ALL_FEATURE_SCHEMAS } from "@/db/features/index";

const PB_MISSING = Object.assign(new Error("Missing or invalid collection name."), {
  status: 404,
  data: { code: 404 },
});

/** pb.collections stub recording every write. */
function collectionsStub(getOne: (name: string) => any) {
  const update = vi.fn(async (_id: string, _payload: any) => ({}));
  const create = vi.fn(async () => ({}));
  return { collections: { getOne: vi.fn(getOne), update, create }, update, create };
}

beforeEach(() => {
  // Health check inside runFeatureMigration — stubbed so the suite never
  // resolves NEXT_PUBLIC_PB_URL (or its LAN default) for real.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200 })),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.getAdminPB.mockReset();
});

describe("reconcileFileFieldLimits — flat fields (PB ≥0.23)", () => {
  it("heals a drifted flat maxSize with a flat write and logs old -> new", async () => {
    const log = vi.spyOn(console, "log");
    const { collections, update } = collectionsStub(() => ({
      id: "col-photos",
      name: "photos",
      fields: [
        { id: "f1", name: "original", type: "file", maxSize: 20971520 },
        { id: "f2", name: "wall", type: "file", maxSize: 8388608 },
        { id: "f3", name: "caption", type: "text" },
      ],
    }));

    const healed = await reconcileFileFieldLimits({ collections }, photosSchema);

    expect(healed).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("col-photos", {
      fields: [
        { id: "f1", name: "original", type: "file", maxSize: 104857600 },
        { id: "f2", name: "wall", type: "file", maxSize: 8388608 },
        { id: "f3", name: "caption", type: "text" },
      ],
    });
    expect(log).toHaveBeenCalledWith("  🔧 photos.original: 20971520 -> 104857600");
  });
});

describe("reconcileFileFieldLimits — nested fields (PB <0.23)", () => {
  it("heals a drifted nested maxSize with a NESTED write, leaving flat alone", async () => {
    const { collections, update } = collectionsStub(() => ({
      id: "col-photos",
      name: "photos",
      fields: [
        { id: "f1", name: "original", type: "file", options: { maxSize: 20971520, mimeTypes: [] } },
        { id: "f2", name: "wall", type: "file", options: { maxSize: 8388608, mimeTypes: [] } },
      ],
    }));

    const healed = await reconcileFileFieldLimits({ collections }, photosSchema);

    expect(healed).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][1] as { fields: Record<string, any>[] };
    expect(payload.fields[0].options).toEqual({ maxSize: 104857600, mimeTypes: [] });
    expect(payload.fields[0].maxSize).toBeUndefined();
    expect(payload.fields[1].options.maxSize).toBe(8388608);
  });
});

describe("reconcileFileFieldLimits — no drift", () => {
  it("writes nothing when live limits already match the schema", async () => {
    const { collections, update } = collectionsStub(() => ({
      id: "col-photos",
      name: "photos",
      fields: [
        { id: "f1", name: "original", type: "file", maxSize: 104857600 },
        { id: "f2", name: "wall", type: "file", maxSize: 8388608 },
      ],
    }));

    const healed = await reconcileFileFieldLimits({ collections }, photosSchema);

    expect(healed).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("never touches collections with no file fields", async () => {
    const getOne = vi.fn();
    const { collections, update } = collectionsStub(getOne);

    const healed = await reconcileFileFieldLimits({ collections }, {
      name: "daily_quotes",
      type: "base",
      fields: [{ name: "text", type: "text", required: false }],
    });

    expect(healed).toBe(0);
    expect(getOne).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("create/tally (runFeatureMigration)", () => {
  /** pb where every collection probe says "absent" but create blows up. */
  function failingCreatePb() {
    const { collections } = collectionsStub(() => ({}));
    collections.create.mockImplementation(async () => {
      throw new Error("create failed");
    });
    return {
      collections,
      collection: () => ({ getList: async () => Promise.reject(PB_MISSING) }),
    };
  }

  it("counts a throwing collections.create as FAILED, not skipped", async () => {
    const pb = failingCreatePb();
    mocks.getAdminPB.mockReturnValue(pb);

    const result = await runFeatureMigration();

    // Exact shape: main() reads result.failed to decide process.exit(1).
    expect(result).toEqual({
      created: 0,
      skipped: 0,
      failed: ALL_FEATURE_SCHEMAS.length,
    });
    expect(pb.collections.create).toHaveBeenCalledTimes(ALL_FEATURE_SCHEMAS.length);
    expect(pb.collections.getOne).not.toHaveBeenCalled();
  });

  it("counts an unreachable probe as failed and does NOT create blindly", async () => {
    const { collections } = collectionsStub(() => {
      throw new Error("no getOne expected in this test");
    });
    const create = vi.fn();
    const pb = {
      collections: { ...collections, create },
      collection: () => ({ getList: async () => Promise.reject(new Error("ECONNREFUSED")) }),
    };
    mocks.getAdminPB.mockReturnValue(pb);

    const result = await runFeatureMigration();

    expect(result).toEqual({
      created: 0,
      skipped: 0,
      failed: ALL_FEATURE_SCHEMAS.length,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("reconciles file limits for collections that already exist (the skipped path)", async () => {
    const { collections, update, create } = collectionsStub((name) =>
      name === "photos"
        ? {
            id: "col-photos",
            name: "photos",
            fields: [{ id: "f1", name: "original", type: "file", maxSize: 20971520 }],
          }
        : { id: name, name, fields: [] },
    );
    const pb = {
      collections,
      collection: () => ({ getList: async () => ({ items: [] }) }),
    };
    mocks.getAdminPB.mockReturnValue(pb);

    const result = await runFeatureMigration();

    expect(result).toEqual({
      created: 0,
      skipped: ALL_FEATURE_SCHEMAS.length,
      failed: 0,
    });
    expect(create).not.toHaveBeenCalled();
    // Exactly one drifted field in the repo's schemas today: photos.original.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe("col-photos");
    expect((update.mock.calls[0][1] as { fields: any[] }).fields[0]).toEqual({
      id: "f1",
      name: "original",
      type: "file",
      maxSize: 104857600,
    });
  });
});
