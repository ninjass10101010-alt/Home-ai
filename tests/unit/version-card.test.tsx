// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VersionCard from "@/components/settings/VersionCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function response(ok: boolean, status: number, body: Record<string, unknown> = {}) {
  return { ok, status, statusText: status === 200 ? "OK" : "Error", json: async () => body };
}

function stubFetch(update: (url: string, init?: RequestInit) => ReturnType<typeof response> | Promise<ReturnType<typeof response>>) {
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return update(url, init);
  }));
}

function render(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(ui));
  return host;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(scope: ParentNode, pattern: RegExp): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll("button")).find((candidate) =>
    pattern.test(candidate.textContent || "") || pattern.test(candidate.getAttribute("aria-label") || ""),
  );
  if (!result) throw new Error(`Button matching ${pattern} not found`);
  return result;
}

function dialog(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!result) throw new Error("Dialog not found");
  return result;
}

const AVAILABLE = {
  ok: true,
  built_at: { hash: "local", short: "local1", message: "Local build", date: "2026-09-20T10:00:00.000Z" },
  latest_remote: { hash: "remote", short: "remote1", message: "Remote build", date: "2026-09-21T10:00:00.000Z" },
  update_available: true,
  commits_behind: 2,
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VersionCard", () => {
  it("checks the version response status instead of trusting a JSON ok flag", async () => {
    stubFetch(() => response(false, 500, { ok: true, update_available: true }));
    const host = render(<VersionCard />);
    await settle();

    expect(host.textContent).toContain("Couldn't reach the update service");
    expect(host.textContent).not.toContain("Update now");
  });

  it("surfaces an adult-only response without treating it as an available update", async () => {
    stubFetch(() => response(false, 403, { ok: false, error: "adult_only" }));
    const host = render(<VersionCard />);
    await settle();

    expect(host.textContent).toContain("Adults only");
    expect(host.textContent).not.toContain("Update now");
  });

  it("does not call a missing remote version Up to date", async () => {
    stubFetch(() => response(true, 200, { ...AVAILABLE, latest_remote: null, update_available: false }));
    const host = render(<VersionCard />);
    await settle();

    expect(host.textContent).toContain("Couldn't check for updates");
    expect(host.textContent).not.toContain("Up to date");
    expect(button(host, /Try again/)).toBeTruthy();
  });

  it("does not show an unknown local hash as Up to date", async () => {
    stubFetch(() => response(true, 200, {
      ...AVAILABLE,
      built_at: { ...AVAILABLE.built_at, hash: "unknown" },
      update_available: false,
    }));
    const host = render(<VersionCard />);
    await settle();

    expect(host.textContent).toContain("unknown");
    expect(host.textContent).not.toContain("Up to date");
    expect(button(host, /Try again/)).toBeTruthy();
  });
  it("does not POST a second update after a successful completion", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST") return response(true, 200, { ok: true, logs: [] });
      return response(true, 200, AVAILABLE);
    });
    const host = render(<VersionCard />);
    await settle();

    await act(async () => button(host, /Update now \(self-update\)/).click());
    await act(async () => button(dialog(), /^Update now$/).click());
    await settle();
    expect(host.textContent).toContain("Done — reloading");

    await act(async () => button(host, /Done — reloading/).click());
    expect(fetchCalls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
  });

  it("guards duplicate update confirmations while the POST is pending", async () => {
    const pending = deferred<any>();
    stubFetch((url, init) => {
      if (init?.method === "POST") return pending.promise;
      return response(true, 200, AVAILABLE);
    });
    const host = render(<VersionCard />);
    await settle();
    await act(async () => button(host, /Update now \(self-update\)/).click());
    const confirm = button(dialog(), /^Update now$/);
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(fetchCalls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
    await act(async () => {
      pending.resolve(response(true, 200, { ok: true, logs: [] }));
      await Promise.resolve();
    });
    await settle();
  });

  it("clears the pending reload timer when the version card unmounts", async () => {
    vi.useFakeTimers();
    stubFetch((url, init) => {
      if (init?.method === "POST") return response(true, 200, { ok: true, logs: [] });
      return response(true, 200, AVAILABLE);
    });
    const host = render(<VersionCard />);
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await act(async () => button(host, /Update now \(self-update\)/).click());
    await act(async () => button(dialog(), /^Update now$/).click());
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    const root = roots.pop();
    if (root) act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it("rejects a malformed update log row instead of rendering it or claiming completion", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST") {
        return response(true, 200, {
          ok: true,
          logs: [
            { step: "git-pull", status: "ok", detail: "Already up to date", timestamp: "2026-09-24T10:00:00.000Z" },
            { step: "build", status: "error", detail: { raw: "malformed" }, timestamp: "2026-09-24T10:01:00.000Z" },
          ],
        });
      }
      return response(true, 200, AVAILABLE);
    });
    const host = render(<VersionCard />);
    await settle();
    await act(async () => button(host, /Update now \(self-update\)/).click());
    await act(async () => button(dialog(), /^Update now$/).click());
    await settle();

    expect(host.textContent).toContain("invalid update progress response");
    expect(host.textContent).not.toContain("[object Object]");
    expect(host.textContent).not.toContain("Done — reloading");
  });

  it("keeps authorization failures distinct from a generic update outage", async () => {
    stubFetch(() => response(false, 401, { ok: false }));
    const host = render(<VersionCard />);
    await settle();

    expect(host.textContent).toContain("Sign in as a parent");
  });
  it("confirms self-update before POSTing and reports a failed response", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST") return response(false, 500, { ok: false, error: "update failed", logs: [] });
      return response(true, 200, AVAILABLE);
    });
    const host = render(<VersionCard />);
    await settle();

    await act(async () => button(host, /Update now \(self-update\)/).click());
    expect(fetchCalls.some((call) => call.init?.method === "POST")).toBe(false);
    expect(dialog().textContent).toContain("Update dashboard now?");

    await act(async () => button(dialog(), /^Cancel$/).click());
    expect(fetchCalls.some((call) => call.init?.method === "POST")).toBe(false);

    await act(async () => button(host, /Update now \(self-update\)/).click());
    await act(async () => button(dialog(), /^Update now$/).click());
    await settle();

    const post = fetchCalls.find((call) => call.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(host.textContent).toContain("update failed");
    expect(host.textContent).not.toContain("Done — reloading");
  });
});
