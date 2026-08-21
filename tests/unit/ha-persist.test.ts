import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeColl = vi.hoisted(() => ({
  getFirstListItem: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const fakePb = vi.hoisted(() => ({
  collection: vi.fn(() => fakeColl),
}));

vi.mock("../../src/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => fn(fakePb),
}));

import { upsertHAEntity, upsertHAEntities, deleteHAEntity, HAEntityRecord } from "../../src/lib/ha/persist";

const record: HAEntityRecord = {
  entity_id: "light.kitchen",
  domain: "light",
  object_id: "kitchen",
  friendly_name: "Kitchen Light",
  area_id: "kitchen",
  state: "on",
  attributes: { brightness: 255 },
  last_updated: "2026-08-21T12:00:00Z",
  source: "ha",
};

// Spy ONCE at module scope; re-spying per test would stack mocks and leak
// call history across tests.
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

describe("upsertHAEntity", () => {
  beforeEach(() => {
    fakeColl.getFirstListItem.mockReset();
    fakeColl.create.mockReset();
    fakeColl.update.mockReset();
    fakePb.collection.mockClear();
    vi.mocked(console.log).mockClear();
    vi.mocked(console.warn).mockClear();
  });

  it("creates when the entity does not exist (404)", async () => {
    fakeColl.getFirstListItem.mockRejectedValue({ status: 404 });

    await upsertHAEntity(record);

    expect(fakePb.collection).toHaveBeenCalledWith("ha_entities");
    expect(fakeColl.getFirstListItem).toHaveBeenCalledWith(`entity_id="${record.entity_id}"`);
    expect(fakeColl.create).toHaveBeenCalledWith(record);
    expect(fakeColl.update).not.toHaveBeenCalled();
  });

  it("updates when the entity already exists", async () => {
    fakeColl.getFirstListItem.mockResolvedValue({ id: "abc" });

    await upsertHAEntity(record);

    expect(fakeColl.update).toHaveBeenCalledWith("abc", record);
    expect(fakeColl.create).not.toHaveBeenCalled();
  });

  it("resolves without writing on a non-404 error", async () => {
    fakeColl.getFirstListItem.mockRejectedValue({ status: 400, message: "bad filter" });

    await expect(upsertHAEntity(record)).resolves.toBeUndefined();

    expect(fakeColl.create).not.toHaveBeenCalled();
    expect(fakeColl.update).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("recovers by updating the winner when a concurrent create loses the unique race", async () => {
    // First lookup: entity not found → create path
    fakeColl.getFirstListItem.mockRejectedValueOnce({ status: 404 });
    // Concurrent writer won: our create hits the unique index (PB returns 400)
    fakeColl.create.mockRejectedValueOnce({ status: 400, response: { code: "unique_index" } });
    // Recovery lookup finds the winner's row
    fakeColl.getFirstListItem.mockResolvedValueOnce({ id: "winner" });
    fakeColl.update.mockResolvedValue(undefined);

    await upsertHAEntity(record);

    expect(fakeColl.create).toHaveBeenCalledTimes(1);
    expect(fakeColl.update).toHaveBeenCalledWith("winner", record);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("deleteHAEntity", () => {
  beforeEach(() => {
    fakeColl.getFirstListItem.mockReset();
    fakeColl.delete.mockReset();
    vi.mocked(console.warn).mockClear();
  });

  it("deletes the cached row for a removed entity", async () => {
    fakeColl.getFirstListItem.mockResolvedValue({ id: "gone" });
    fakeColl.delete.mockResolvedValue(undefined);

    await deleteHAEntity("light.old");

    expect(fakeColl.getFirstListItem).toHaveBeenCalledWith('entity_id="light.old"');
    expect(fakeColl.delete).toHaveBeenCalledWith("gone");
  });

  it("ignores 404 when the row is already gone", async () => {
    fakeColl.getFirstListItem.mockRejectedValue({ status: 404 });

    await deleteHAEntity("light.never_existed");

    expect(fakeColl.delete).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("upsertHAEntities", () => {
  beforeEach(() => {
    fakeColl.getFirstListItem.mockReset();
    fakeColl.create.mockReset();
    fakeColl.update.mockReset();
    fakePb.collection.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("continues after one record fails and still writes the rest", async () => {
    const second: HAEntityRecord = {
      ...record,
      entity_id: "light.hall",
      object_id: "hall",
    };

    fakeColl.getFirstListItem
      .mockRejectedValueOnce({ status: 500, message: "boom" })
      .mockResolvedValueOnce({ id: "def" });

    await expect(upsertHAEntities([record, second])).resolves.toBeUndefined();

    expect(fakeColl.create).not.toHaveBeenCalled();
    expect(fakeColl.update).toHaveBeenCalledTimes(1);
    expect(fakeColl.update).toHaveBeenCalledWith("def", second);
    expect(fakeColl.getFirstListItem).toHaveBeenCalledTimes(2);
  });
});
