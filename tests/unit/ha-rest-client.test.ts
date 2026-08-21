import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchHADeviceStates } from "../../src/lib/ha/rest-client";

describe("fetchHADeviceStates", () => {
  beforeEach(() => {
    process.env.HA_HOST = "http://homeassistant:8123";
    process.env.HA_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Bearer token and returns only watched domains", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          entity_id: "light.kitchen",
          state: "on",
          attributes: { friendly_name: "Kitchen" },
          last_updated: "t1",
        },
        {
          entity_id: "media_player.tv",
          state: "on",
          attributes: {},
          last_updated: "t2",
        },
        {
          entity_id: "person.jeffery",
          state: "home",
          attributes: {},
          last_updated: "t3",
        },
      ],
    } as unknown as Response);

    const result = await fetchHADeviceStates();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://homeassistant:8123/api/states",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(result.map((e) => e.entity_id)).toEqual([
      "light.kitchen",
      "person.jeffery",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      entity_id: "light.kitchen",
      state: "on",
      attributes: { friendly_name: "Kitchen" },
      last_updated: "t1",
    });
  });

  it("throws when HA returns non-ok", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
    } as unknown as Response);

    await expect(fetchHADeviceStates()).rejects.toThrow(
      "HA REST fetch failed: 401"
    );
  });

  it("maps malformed rows safely", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ entity_id: null }, { entity_id: "light.kitchen" }],
    } as unknown as Response);

    const result = await fetchHADeviceStates();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      entity_id: "light.kitchen",
      state: "",
      attributes: {},
      last_updated: "",
    });
  });

  it("accepts an explicit config instead of env", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    await fetchHADeviceStates({ haHost: "http://ha2:8123", haToken: "tok2" });

    expect(fetchMock).toHaveBeenCalledWith("http://ha2:8123/api/states", {
      headers: { Authorization: "Bearer tok2" },
    });
  });
});
