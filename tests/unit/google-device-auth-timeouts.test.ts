import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAccountEmail, revokeGoogleToken } from "@/lib/google/device-auth";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Google remote auth timeouts", () => {
  it("supplies a five-second timeout signal to userinfo and revocation fetches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: "family@example.com" }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAccountEmail("access-token");
    await revokeGoogleToken("refresh-token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ signal: expect.any(AbortSignal) });
    }
  });

  it("returns the existing null and false fallbacks when the bounded signals abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const email = fetchAccountEmail("access-token");
    const revocation = revokeGoogleToken("refresh-token");
    controller.abort();

    await expect(email).resolves.toBeNull();
    await expect(revocation).resolves.toBe(false);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(5_000);
  });
});
