import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import {
  COLLECTIONS,
  assertCollectionContract,
  collectionFieldsForSeed,
  seedCollections,
  verifyCollectionContract,
} from "@/lib/pb-seed";
import type { PbCollectionContract } from "@/lib/pb-seed";

const LOCKED = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

type LiveField = Record<string, unknown> & { name: string };
type LiveRecord = Record<string, unknown> & { id: string; name: string };
type StatefulCollections = {
  getFullList: (args?: unknown) => Promise<any[]>;
  create: (payload: any) => Promise<any>;
  update: (id: string, body: any) => Promise<any>;
};

/** A live PocketBase field as the 0.23+ typed-field API echoes it: min/max/values
 *  sit beside name/type rather than inside an `options` bag, and an autodate's
 *  onCreate/onUpdate flags are top level beside the type. */
function liveFieldFrom(field: any): LiveField {
  if (field.type === "autodate") {
    return {
      name: field.name,
      type: "autodate",
      onCreate: field.options?.onCreate !== false,
      ...(field.options?.onUpdate ? { onUpdate: true } : {}),
    };
  }
  const live: LiveField = {
    name: field.name,
    type: field.type,
    required: !!field.required,
  };
  if (field.type === "select") {
    live.values = [...(field.options?.values ?? [])];
    if (field.options?.maxSelect !== undefined) live.maxSelect = field.options.maxSelect;
  }
  if (field.options?.max !== undefined) live.max = field.options.max;
  if (field.options?.min !== undefined) live.min = field.options.min;
  return live;
}

function contractFor(name: string) {
  return COLLECTIONS.find((c) => c.name === name);
}

function fieldsFromContract(name: string): LiveField[] {
  const contract = contractFor(name);
  if (!contract) throw new Error(`no contract for ${name}`);
  return collectionFieldsForSeed(contract).map((field) => liveFieldFrom(field));
}

function liveCollection(name: string, overrides: Record<string, unknown> = {}): LiveRecord {
  const contract = contractFor(name);
  if (!contract) throw new Error(`no contract for ${name}`);
  return {
    id: `live_${name}`,
    name,
    type: "base",
    fields: fieldsFromContract(name),
    indexes: [...(contract.indexes ?? [])],
    ...LOCKED,
    ...overrides,
  };
}

/** Minimal in-memory PocketBase collections API whose reads reflect writes, so
 *  the final-state verification sees exactly what the seed left behind. */
function makeStatefulPb(existing: any[] = []) {
  const state: any[] = structuredClone(existing);
  const pb: { state: any[]; collections: StatefulCollections } = {
    state,
    collections: {
      getFullList: async () => structuredClone(state),
      create: async (payload: any) => {
        const record = { id: `new_${payload.name}`, ...structuredClone(payload) };
        state.push(record);
        return record;
      },
      update: async (id: string, body: any) => {
        const record = state.find((c: any) => c.id === id);
        if (record) Object.assign(record, structuredClone(body));
        return { id, ...body };
      },
    },
  };
  return pb;
}

type StatefulPb = ReturnType<typeof makeStatefulPb>;

async function seedCollectionsAgainst(pb: unknown): Promise<void> {
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
  await seedCollections();
}

async function seededPb(): Promise<StatefulPb> {
  const pb = makeStatefulPb([]);
  await seedCollectionsAgainst(pb);
  return pb;
}

function mutateLive(pb: StatefulPb, name: string, patch: (record: any) => void): void {
  const record = pb.state.find((c: any) => c.name === name);
  if (!record) throw new Error(`no live collection ${name}`);
  patch(record);
}

function fieldNamed(record: any, fieldName: string): any {
  const field = (record.fields as any[]).find((f) => f.name === fieldName);
  if (!field) throw new Error(`no live field ${fieldName}`);
  return field;
}

const DATE_BOUND_CONTRACT: PbCollectionContract = {
  name: "probe_dates",
  schema: [
    { name: "label", type: "text", required: true },
    { name: "window", type: "date", options: { min: 1, max: 9 } },
  ],
};

function fixtureLivePb(contract: PbCollectionContract, mutate?: (fields: LiveField[]) => void) {
  const fields = collectionFieldsForSeed(contract).map((field) => liveFieldFrom(field));
  mutate?.(fields);
  return makeStatefulPb([
    {
      id: `live_${contract.name}`,
      name: contract.name,
      type: "base",
      fields,
      indexes: [...(contract.indexes ?? [])],
      ...LOCKED,
    },
  ]);
}

function eventsWithScoreMax(max: number) {
  return liveCollection("events", {
    fields: fieldsFromContract("events").map((field) =>
      field.name === "importanceScore" ? { ...field, max } : field
    ),
  });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("seed contract verification — final live state", () => {
  it("rejects an unreadable final collection", async () => {
    const pb = makeStatefulPb([]);
    await seedCollectionsAgainst(pb);
    pb.collections.getFullList = async () => [
      {
        id: "members-live",
        name: "members",
        fields: fieldsFromContract("members"),
        indexes: [],
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
      },
    ];

    const issues = await verifyCollectionContract(pb);
    expect(issues.join("\n")).toContain("members.listRule");
    await expect(assertCollectionContract(pb)).rejects.toThrow(
      /contract verification failed/i
    );
  });

  it("reports a collection the final state never created", async () => {
    const pb = await seededPb();
    pb.state.splice(
      pb.state.findIndex((c: any) => c.name === "members"),
      1
    );

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("missing collection: members");
    await expect(assertCollectionContract(pb)).rejects.toThrow(
      /PocketBase contract verification failed/
    );
  });

  it("reports a field the final state never created", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      record.fields = record.fields.filter((f: any) => f.name !== "age");
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.age: field missing");
  });

  it("reports a field whose type drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "emoji").type = "json";
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues.join("\n")).toContain("members.emoji");
    expect(issues.join("\n")).toMatch(/members\.emoji: expected type text/);
  });

  it("reports a required flag that drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "name").required = false;
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.name: must be required");
  });

  it("reports a text max that drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "emoji").max = 5000;
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues.join("\n")).toMatch(/members\.emoji: text max/);
  });

  it("reports a number bound that drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "events", (record) => {
      fieldNamed(record, "importanceScore").max = 50;
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues.join("\n")).toMatch(/events\.importanceScore: number max/);
  });

  it("reports a date bound that drifted", async () => {
    const pb = fixtureLivePb(DATE_BOUND_CONTRACT, (fields) => {
      fields.find((f) => f.name === "window")!.max = 5;
    });

    expect(await verifyCollectionContract(pb, [DATE_BOUND_CONTRACT])).toEqual([
      "probe_dates.window: date max mismatch",
    ]);
  });

  it("accepts a date bound the live state already matches", async () => {
    const pb = fixtureLivePb(DATE_BOUND_CONTRACT);

    expect(await verifyCollectionContract(pb, [DATE_BOUND_CONTRACT])).toEqual([]);
  });

  it("reports a date min bound that drifted", async () => {
    const pb = fixtureLivePb(DATE_BOUND_CONTRACT, (fields) => {
      fields.find((f) => f.name === "window")!.min = 4;
    });

    expect(await verifyCollectionContract(pb, [DATE_BOUND_CONTRACT])).toEqual([
      "probe_dates.window: date min mismatch",
    ]);
  });

  it("reports an autodate field the final state never created", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      record.fields = record.fields.filter((f: any) => f.name !== "updated");
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.updated: field missing");
  });

  it("reports an autodate field whose onCreate flag drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "created").onCreate = false;
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.created: autodate onCreate must be true");
  });

  it("reports an autodate field whose onUpdate flag drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "updated").onUpdate = false;
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.updated: autodate onUpdate mismatch");
  });

  it("reports an autodate field whose type drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      fieldNamed(record, "created").type = "text";
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain("members.created: expected type autodate");
  });

  it("heals an out-of-bounds live number field and then passes verification", async () => {
    const pb = makeStatefulPb([eventsWithScoreMax(50)]);

    await seedCollectionsAgainst(pb);

    const live = pb.state.find((c: any) => c.name === "events");
    expect(fieldNamed(live, "importanceScore").max).toBe(100);
    expect(await verifyCollectionContract(pb)).toEqual([]);
  });

  it("heals an out-of-bounds live number min and then passes verification", async () => {
    const pb = makeStatefulPb([
      liveCollection("events", {
        fields: fieldsFromContract("events").map((field) =>
          field.name === "importanceScore" ? { ...field, min: 7 } : field
        ),
      }),
    ]);

    await seedCollectionsAgainst(pb);

    const live = pb.state.find((c: any) => c.name === "events");
    expect(fieldNamed(live, "importanceScore").min).toBe(0);
    expect(await verifyCollectionContract(pb)).toEqual([]);
  });

  it("reports select values that drifted", async () => {
    const pb = await seededPb();
    mutateLive(pb, "proactive_suggestions", (record) => {
      fieldNamed(record, "kind").values = ["pantry_low", "custom"];
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues.join("\n")).toMatch(/proactive_suggestions\.kind: select values/);
  });

  it("reports an expected index the final state never created", async () => {
    const pb = await seededPb();
    mutateLive(pb, "proactive_suggestions", (record) => {
      record.indexes = [];
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues).toContain(
      "proactive_suggestions: missing index idx_hash_unique"
    );
  });

  it("reports every one of the five rules that is not null", async () => {
    const pb = await seededPb();
    mutateLive(pb, "pantry_items", (record) => {
      record.listRule = "";
      record.viewRule = "member.id = @request.auth.id";
      record.createRule = "";
      record.updateRule = "";
      record.deleteRule = "";
    });

    const issues = await verifyCollectionContract(pb);
    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      expect(issues, `${rule} must be reported`).toContain(
        `pantry_items.${rule}: must be null`
      );
    }
  });

  it("accepts a clean reconciled state", async () => {
    const pb = await seededPb();

    expect(await verifyCollectionContract(pb)).toEqual([]);
    await expect(assertCollectionContract(pb)).resolves.toBeUndefined();
  });

  it("accepts a clean state that keeps extra legacy fields and a different field order", async () => {
    const pb = makeStatefulPb([
      liveCollection("members", {
        fields: [
          ...fieldsFromContract("members").reverse(),
          { name: "legacy_nickname", type: "text", required: false, max: 0 },
        ],
      }),
    ]);
    await seedCollectionsAgainst(pb);

    expect(await verifyCollectionContract(pb, [contractFor("members")!])).toEqual([]);
  });

  it("verifies only the contracts it is handed", async () => {
    const pb = await seededPb();
    mutateLive(pb, "recipes", (record) => {
      fieldNamed(record, "name").required = false;
    });

    expect(await verifyCollectionContract(pb, [contractFor("members")!])).toEqual([]);
    expect(
      (await verifyCollectionContract(pb, [contractFor("recipes")!])).join("\n")
    ).toContain("recipes.name: must be required");
  });

  it("never echoes a live rule expression or any field value", async () => {
    const pb = await seededPb();
    mutateLive(pb, "members", (record) => {
      record.listRule = 'auth.email = "pb-admin@example.test"';
    });

    const issues = await verifyCollectionContract(pb);
    expect(issues.join(" ")).toContain("members.listRule");
    expect(issues.join(" ")).not.toContain("pb-admin@example.test");
    expect(issues.join(" ")).not.toContain("auth.email");
  });
});

describe("seed exits nonzero unless the final state matches", () => {
  it("throws when a heal did not actually land on the live collection", async () => {
    const pb = makeStatefulPb([
      liveCollection("members", {
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
      }),
    ]);
    // A live instance that keeps refusing the lock patch (PB ignored the write).
    pb.collections.update = vi.fn(async (id: string, body: any) => ({ id, ...body }));

    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await expect(seedCollections()).rejects.toThrow(
      /PocketBase contract verification failed/
    );
    await expect(seedCollections()).rejects.toThrow(/members\.listRule/);
  });

  it("resolves for a seed whose final state is clean", async () => {
    const pb = makeStatefulPb([liveCollection("members")]);
    await expect(seedCollectionsAgainst(pb)).resolves.toBeUndefined();
  });

  it("throws when a dropped number-bound patch never lands", async () => {
    const pb = makeStatefulPb([eventsWithScoreMax(50)]);
    const attempted = vi.fn(async (id: string, body: any) => ({ id, ...body }));
    pb.collections.update = attempted;

    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await expect(seedCollections()).rejects.toThrow(
      /events\.importanceScore: number max mismatch/
    );
    const bodies = attempted.mock.calls.map((call) => (call[1] as any).fields as any[] | undefined);
    const healed = bodies.find((fields) => fields?.some((f) => f.name === "importanceScore"));
    expect(healed).toBeDefined();
    expect(healed!.find((f) => f.name === "importanceScore").max).toBe(100);
  });

  it("throws when a failed autodate heal never lands", async () => {
    const pb = makeStatefulPb([
      liveCollection("members", {
        fields: fieldsFromContract("members").map((field) =>
          field.name === "created" ? { ...field, onUpdate: true } : field
        ),
      }),
    ]);
    pb.collections.update = vi.fn(async (id: string, body: any) => ({ id, ...body }));

    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await expect(seedCollections()).rejects.toThrow(
      /members\.created: autodate onUpdate mismatch/
    );
  });

  it("throws when a dropped autodate field patch never lands", async () => {
    const pb = makeStatefulPb([
      liveCollection("members", {
        fields: fieldsFromContract("members").filter((field) => field.name !== "updated"),
      }),
    ]);
    pb.collections.update = vi.fn(async (id: string, body: any) => ({ id, ...body }));

    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    await expect(seedCollections()).rejects.toThrow(/members\.updated: field missing/);
  });
});

describe("collectionFieldsForSeed", () => {
  it("appends the PB-standard created/updated autodate fields", () => {
    const fields = collectionFieldsForSeed(contractFor("members")!);
    const names = fields.map((f) => f.name);
    expect(names).toContain("created");
    expect(names).toContain("updated");
    expect(fields.find((f) => f.name === "created")?.type).toBe("autodate");
    expect(fields.find((f) => f.name === "updated")?.type).toBe("autodate");
  });

  it("never duplicates an autodate field the contract already declares", () => {
    const withAutodate = {
      name: "probe",
      schema: [
        { name: "name", type: "text" as const },
        { name: "created", type: "autodate" as const },
        { name: "updated", type: "autodate" as const },
      ],
    };
    const names = collectionFieldsForSeed(withAutodate).map((f) => f.name);
    expect(names).toEqual(["name", "created", "updated"]);
  });

  it("returns the contract's own field objects for the declared schema", () => {
    const contract = contractFor("events")!;
    const fields = collectionFieldsForSeed(contract);
    expect(fields.slice(0, contract.schema.length)).toEqual([...contract.schema]);
  });
});
