import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "../fixtures/composio-contract.json";

const { getServiceConfig } = vi.hoisted(() => ({ getServiceConfig: vi.fn() }));
vi.mock("@/lib/services/config", () => ({ getServiceConfig }));

import {
  createConnectedAccountLink, ensureAuthConfig, executeComposioAction, getConnectedAccount,
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

  it("throws api_error when a 200 execute response is malformed", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(executeComposioAction("X", {})).rejects.toMatchObject({
      code: "api_error", message: "Composio returned an empty response",
    });
  });

  it("does not leak the key in a 401 error message", async () => {
    getServiceConfig.mockResolvedValue("sk-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const error = await executeComposioAction("X", {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "auth_failed" });
    expect(String((error as Error).message)).not.toContain("sk-secret");
  });

  it("reuses an existing auth config without creating one", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "ac_1" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureAuthConfig("googlecalendar")).resolves.toBe("ac_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth_configs?toolkit_slug=googlecalendar");
    expect(init.method).toBe("GET");
  });

  it("creates a managed auth config when the toolkit has none", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ac_new" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureAuthConfig("googlecalendar")).resolves.toBe("ac_new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("/auth_configs");
    const body = JSON.parse(String(init.body));
    expect(body.toolkit.slug).toBe("googlecalendar");
    expect(body.auth_config.type).toBe("use_composio_managed_auth");
  });

  it("creates a managed auth config when the list 404s", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ac_404" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureAuthConfig("googlecalendar")).resolves.toBe("ac_404");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a list network failure as api_error and does not create", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureAuthConfig("googlecalendar")).rejects.toMatchObject({ code: "api_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-404 list failure and does not create", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureAuthConfig("googlecalendar")).rejects.toMatchObject({ code: "api_error", status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a connected-account link and maps the response", async () => {
    getServiceConfig.mockResolvedValue("sk-test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "ac_1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        redirect_url: "https://backend.composio.dev/link/abc",
        connected_account_id: "ca_link_1",
        expires_at: "2030-01-01T00:00:00.000Z",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createConnectedAccountLink("googlecalendar")).resolves.toEqual({
      redirectUrl: "https://backend.composio.dev/link/abc",
      connectedAccountId: "ca_link_1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("/connected_accounts/link");
    const body = JSON.parse(String(init.body));
    expect(body.auth_config_id).toBe("ac_1");
    expect(body.user_id).toBe("consuela-family");
  });
});
