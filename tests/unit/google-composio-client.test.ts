import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "../fixtures/composio-contract.json";

const { getServiceConfig } = vi.hoisted(() => ({ getServiceConfig: vi.fn() }));
vi.mock("@/lib/services/config", () => ({ getServiceConfig }));

import {
  executeComposioAction, getConnectedAccount,
} from "@/lib/google/composio";

describe("composio client", () => {
  beforeEach(() => { getServiceConfig.mockReset(); vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("throws not_configured when the key is absent", async () => {
    getServiceConfig.mockResolvedValue(null);
    await expect(executeComposioAction("X", {})).rejects.toMatchObject({ code: "not_configured" });
  });

  it("executes via v3.1 with X-API-Key and never leaks the key", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture.executeListEvents), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await executeComposioAction("GOOGLECALENDAR_X", { calendar_id: "primary" }, "ca_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v3.1/tools/execute/GOOGLECALENDAR_X");
    expect((init.headers as Record<string,string>)["X-API-Key"]).toBe("sk-test");
    expect(JSON.stringify(init.body)).toContain("ca_1");
    expect(JSON.stringify(data)).not.toContain("sk-test");
  });

  it("maps 401 to auth_failed and 500 to api_error", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(executeComposioAction("X", {})).rejects.toMatchObject({ code: "auth_failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(executeComposioAction("X", {})).rejects.toMatchObject({ code: "api_error", status: 500 });
  });

  it("returns null for an unknown connected account", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await getConnectedAccount("missing")).toBeNull();
  });
});
