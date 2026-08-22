import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { syncGroceryMirror } from "../../src/lib/ha/todo-mirror";

function makePb({
  grocery,
  mirrorNames,
  savedCapture,
  todoEntities = [{ entity_id: "todo.consuela_grocery", friendly_name: "Consuela Grocery" }],
}: {
  grocery: Array<{ id: string; name: string; needed?: boolean }>;
  mirrorNames: string[] | null;
  savedCapture: { names?: string[] };
  todoEntities?: Array<{ entity_id: string; friendly_name?: string }>;
}) {
  return {
    collection: (name: string) => {
      if (name === "grocery_list_items") {
        return { getFullList: async () => grocery };
      }
      if (name === "ha_entities") {
        return { getFullList: async () => todoEntities };
      }
      if (name === "ha_mirror_state") {
        return {
          getFirstListItem: async () => {
            if (mirrorNames === null) throw { status: 404 };
            return { id: "m1", key: "grocery", names: JSON.stringify(mirrorNames) };
          },
          update: async (_id: string, data: { names: string }) => {
            savedCapture.names = JSON.parse(data.names);
            return data;
          },
          create: async (data: { names: string }) => {
            savedCapture.names = JSON.parse(data.names);
            return data;
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

describe("syncGroceryMirror", () => {
  beforeEach(() => {
    vi.stubEnv("HA_GROCERY_TODO_NAME", "Consuela Grocery");
    mocks.callService.mockReset().mockResolvedValue(null);
    mocks.getHAWebSocketClient.mockReset().mockReturnValue({
      status: "connected",
      callService: mocks.callService,
    });
    mocks.withAdmin.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.warn).mockClear();
  });

  it("adds new needed items, removes bought items, saves the new state", async () => {
    const saved: { names?: string[] } = {};
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn(
        makePb({
          grocery: [
            { id: "1", name: "Milk", needed: true },
            { id: "2", name: "Eggs", needed: true },
            { id: "3", name: "Chips", needed: false },
          ],
          mirrorNames: ["Chips"],
          savedCapture: saved,
        })
      )
    );

    const result = await syncGroceryMirror();

    expect(result.ok).toBe(true);
    expect(result.added).toEqual(["Eggs", "Milk"]);
    expect(result.removed).toEqual(["Chips"]);

    const calls = mocks.callService.mock.calls;
    expect(calls).toHaveLength(3);
    const addMilk = calls.find((c) => c[1] === "add_item" && (c[2] as any).item === "Milk");
    expect(addMilk?.[0]).toBe("todo");
    expect((addMilk?.[2] as any)?.list).toBe("todo.consuela_grocery");
    expect(calls.some((c) => c[1] === "remove_item" && (c[2] as any).item === "Chips")).toBe(true);
    expect(saved.names).toEqual(["Eggs", "Milk"]);
  });

  it("creates the mirror row on first run and adds everything desired", async () => {
    const saved: { names?: string[] } = {};
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn(
        makePb({
          grocery: [{ id: "1", name: "Milk", needed: true }],
          mirrorNames: null,
          savedCapture: saved,
        })
      )
    );

    const result = await syncGroceryMirror();

    expect(result.ok).toBe(true);
    expect(result.added).toEqual(["Milk"]);
    expect(result.removed).toEqual([]);
    expect(saved.names).toEqual(["Milk"]);
  });

  it("is a no-op when the desired set is unchanged", async () => {
    const saved: { names?: string[] } = {};
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn(
        makePb({
          grocery: [{ id: "1", name: "Milk", needed: true }],
          mirrorNames: ["Milk"],
          savedCapture: saved,
        })
      )
    );

    const result = await syncGroceryMirror();

    expect(result.ok).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(mocks.callService).not.toHaveBeenCalled();
  });

  it("exits quietly when no matching todo list exists in HA", async () => {
    const saved: { names?: string[] } = {};
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn(
        makePb({
          grocery: [{ id: "1", name: "Milk", needed: true }],
          mirrorNames: null,
          savedCapture: saved,
          todoEntities: [],
        })
      )
    );

    const result = await syncGroceryMirror();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_list");
    expect(mocks.callService).not.toHaveBeenCalled();
    expect(saved.names).toBeUndefined();
  });
});
