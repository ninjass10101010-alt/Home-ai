// @vitest-environment node
//
// MUSE tool catalog + guarded execution (Task 9 / B3).
//
// The security contract under test: the allowlist is `museToolCatalog(admin)`
// (the session-agnostic adult toolset minus admin tools for non-admins), and
// `getTool` is ONLY consulted after the name clears that allowlist. A caller
// naming an admin tool with a non-admin token must never reach the registry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ getTool: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) =>
    fn({
      collection: () => ({
        getFullList: async () => [],
        getFirstListItem: async () => {
          throw new Error("404");
        },
        create: async (d: any) => ({ id: "new", ...d }),
        update: async (_id: string, d: any) => ({ id: _id, ...d }),
        delete: async () => true,
      }),
    })
  ),
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedulesRaw: () => [],
    selectMeals: async () => [],
    selectPantry: async () => [],
    selectGrocery: async () => [],
    selectMembers: () => [],
    selectRecipes: () => [],
  },
}));

// Partial mock: keep the REAL registry (buildToolsForOpenAI) but wrap getTool
// in a spy so the "getTool is NOT reached" assertion is possible. The default
// implementation delegates to the real getTool.
vi.mock("@/lib/hermes-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hermes-tools")>();
  mocks.getTool.mockImplementation(actual.getTool as any);
  return { ...actual, getTool: mocks.getTool };
});

import { ADMIN_TOOLS, museToolCatalog, executeMuseTool } from "@/lib/muse/execute";

beforeEach(() => {
  mocks.getTool.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openMeteoResponse() {
  return {
    ok: true,
    json: async () => ({
      current: { temperature_2m: 72.4, apparent_temperature: 70.1, weather_code: 2 },
      daily: {
        temperature_2m_max: [80],
        temperature_2m_min: [60],
        precipitation_probability_max: [15],
      },
    }),
  };
}

describe("museToolCatalog", () => {
  it("returns OpenAI-shape entries and excludes exactly the admin tools unless admin", () => {
    const nonAdmin = museToolCatalog(false);
    const admin = museToolCatalog(true);
    const nonAdminNames = new Set(nonAdmin.map((t) => t.function.name));
    const adminNames = new Set(admin.map((t) => t.function.name));

    for (const name of ADMIN_TOOLS) {
      expect(nonAdminNames.has(name)).toBe(false);
      expect(adminNames.has(name)).toBe(true);
    }

    // The ONLY delta between the two catalogs is the admin set (assert the
    // exact name-set, not a magic count).
    const delta = new Set([...adminNames].filter((n) => !nonAdminNames.has(n)));
    expect(delta).toEqual(new Set(ADMIN_TOOLS));

    // Every non-admin tool survives into the admin catalog.
    for (const n of nonAdminNames) expect(adminNames.has(n)).toBe(true);

    // OpenAI tool shape.
    for (const t of nonAdmin) {
      expect(t.type).toBe("function");
      expect(typeof t.function.name).toBe("string");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toBeTruthy();
    }
  });
});

describe("executeMuseTool", () => {
  it("executes a read tool and returns its parsed JSON object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => openMeteoResponse()));

    const out = await executeMuseTool("get_weather", {}, { admin: false });
    expect(out).not.toHaveProperty("error");
    const result = (out as { result: any }).result;
    expect(result).toBeTypeOf("object");
    expect(result.current_temp).toBe(72);
    expect(result.condition).toBe("Partly cloudy");
  });

  it("rejects an admin tool for a non-admin caller WITHOUT reaching getTool", async () => {
    mocks.getTool.mockClear();
    expect(await executeMuseTool("trigger_update", {}, { admin: false })).toEqual({
      error: "tool not allowed",
      status: 403,
    });
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("allows an admin tool for an admin caller (registry is consulted)", async () => {
    mocks.getTool.mockImplementationOnce(() => ({
      definition: { name: "trigger_update", description: "", parameters: { type: "object", properties: {} } },
      handler: async () => JSON.stringify({ ok: true }),
    }));
    const out = await executeMuseTool("trigger_update", {}, { admin: true });
    expect(out).toEqual({ result: { ok: true } });
    expect(mocks.getTool).toHaveBeenCalledTimes(1);
  });

  it("returns 400 unknown tool for a name outside the registry", async () => {
    const out = await executeMuseTool("definitely_not_a_real_tool", {}, { admin: true });
    expect(out).toEqual({ error: "unknown tool", status: 400 });
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("converts a thrown handler into {error, status:500} and never throws", async () => {
    mocks.getTool.mockImplementationOnce(() => ({
      definition: { name: "get_weather", description: "", parameters: { type: "object", properties: {} } },
      handler: async () => {
        throw new Error("boom");
      },
    }));
    const out = await executeMuseTool("get_weather", {}, { admin: false });
    expect(out).toEqual({ error: "boom", status: 500 });
  });

  it("returns the raw string when the handler output is not JSON", async () => {
    mocks.getTool.mockImplementationOnce(() => ({
      definition: { name: "get_weather", description: "", parameters: { type: "object", properties: {} } },
      handler: async () => "plain text result",
    }));
    expect(await executeMuseTool("get_weather", {}, { admin: false })).toEqual({
      result: "plain text result",
    });
  });
});
