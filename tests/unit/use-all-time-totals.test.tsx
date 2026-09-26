// @vitest-environment jsdom
// The all-time read: PocketBase first, a local cache only when the network or
// the server is unreachable, and NEVER a number the read could not establish.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_TIME_CACHE_KEY, useAllTimeTotals, type AllTimeRead } from "@/hooks/useAllTimeTotals";
import { familyAllTimePoints } from "@/lib/all-time-totals";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
function renderUseAllTimeTotals(): { result: { current: AllTimeRead & { refresh: () => Promise<void> } } } {
  const result = { current: undefined as unknown as AllTimeRead & { refresh: () => Promise<void> } };
  function Probe() {
    result.current = useAllTimeTotals();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(Probe));
  });
  return { result };
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const FETCHED_AT = "2026-09-24T10:00:00.000Z";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    weekStart: "2026-09-21",
    totals: { "Member A": { points: 45, completions: 12 } },
    historyComplete: true,
    source: "pocketbase",
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

function jsonOk(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as unknown as Response;
}

function seedCache(body: unknown) {
  localStorage.setItem(ALL_TIME_CACHE_KEY, JSON.stringify(body));
}

const fetchMock = vi.fn();

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useAllTimeTotals — cache states", () => {
  it("uses PB totals and stores an authoritative cache", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload()));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("authoritative");
    expect(result.current.source).toBe("pocketbase");
    expect(result.current.totals["Member A"].points).toBe(45);
    expect(JSON.parse(localStorage.getItem(ALL_TIME_CACHE_KEY) || "null")).toMatchObject({
      source: "pocketbase",
      historyComplete: true,
    });
  });

  it("labels cached totals as offline rather than authoritative", async () => {
    seedCache(payload());
    fetchMock.mockRejectedValue(new TypeError("network unavailable"));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("offline_cache");
    expect(result.current.source).toBe("local_cache");
    expect(result.current.updatedAt).toBe(FETCHED_AT);
    expect(result.current.totals["Member A"].points).toBe(45);
  });

  it("does not show zero when no cache exists", async () => {
    fetchMock.mockRejectedValue(new TypeError("network unavailable"));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("error");
    expect(result.current.totals).toEqual({});
    expect(result.current.updatedAt).toBeNull();
  });

  it("is loading before the read resolves", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderUseAllTimeTotals();

    expect(result.current.state).toBe("loading");
    expect(result.current.totals).toEqual({});
  });

  it("treats a 5xx like an outage (cache served, labelled offline)", async () => {
    seedCache(payload());
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("offline_cache");
  });

  it("treats a 4xx as an error even with a cache (a refused read is not an outage)", async () => {
    seedCache(payload());
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("error");
    expect(result.current.totals).toEqual({});
  });

  it("an unreadable 200 body never renders a number", async () => {
    seedCache(payload());
    fetchMock.mockResolvedValue(jsonOk({ nonsense: true }));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("offline_cache");
    expect(result.current.totals["Member A"].points).toBe(45);
  });

  it("a corrupt cache is treated as no cache at all", async () => {
    localStorage.setItem(ALL_TIME_CACHE_KEY, "{not json");
    fetchMock.mockRejectedValue(new TypeError("network unavailable"));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("error");
    expect(result.current.totals).toEqual({});
  });
});

describe("useAllTimeTotals — incomplete history", () => {
  it("a historyComplete:false payload reports null totals, never a stored figure", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload({ historyComplete: false })));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.state).toBe("authoritative");
    expect(result.current.totals["Member A"]).toEqual({ points: null, completions: null });
    expect(JSON.parse(localStorage.getItem(ALL_TIME_CACHE_KEY) || "null")).toMatchObject({
      historyComplete: false,
    });
  });

  it("a null completion count stays null (it never becomes 0)", async () => {
    fetchMock.mockResolvedValue(
      jsonOk(payload({ totals: { "Member A": { points: 45, completions: null } } })),
    );
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.totals["Member A"].completions).toBeNull();
  });

  it("a malformed member total is unknown, not zero", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload({ totals: { "Member A": { points: "45" } } })));
    const { result } = renderUseAllTimeTotals();
    await settle();

    expect(result.current.totals["Member A"]).toEqual({ points: null, completions: null });
  });
});

describe("useAllTimeTotals — refresh", () => {
  it("re-reads on the shared consuela-data-refreshed pulse", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload({ totals: { "Member A": { points: 45, completions: 12 } } })));
    const { result } = renderUseAllTimeTotals();
    await settle();
    expect(result.current.totals["Member A"].points).toBe(45);

    fetchMock.mockResolvedValue(jsonOk(payload({ totals: { "Member A": { points: 70, completions: 14 } } })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(result.current.totals["Member A"].points).toBe(70);
  });

  it("keeps the last good value visible (as offline cache) when a refresh fails", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload()));
    const { result } = renderUseAllTimeTotals();
    await settle();
    expect(result.current.state).toBe("authoritative");

    fetchMock.mockRejectedValue(new TypeError("network unavailable"));
    await act(async () => {
      await result.current.refresh();
    });
    await settle();

    expect(result.current.state).toBe("offline_cache");
    expect(result.current.totals["Member A"].points).toBe(45);
  });
});

describe("useAllTimeTotals — one read at a time", () => {
  it("a trigger that lands mid-read never issues a second request", async () => {
    let release: (() => void) | null = null;
    fetchMock.mockReturnValue(new Promise((resolve) => {
      release = () => resolve(jsonOk(payload()));
    }));
    const { result } = renderUseAllTimeTotals();
    await settle(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { release!(); });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("authoritative");
    expect(result.current.totals["Member A"].points).toBe(45);
  });

  it("a settled read does not block the next one", async () => {
    fetchMock.mockResolvedValue(jsonOk(payload()));
    const { result } = renderUseAllTimeTotals();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("authoritative");
  });

  it("a refresh joining an in-flight read resolves with that read's result", async () => {
    let release: (() => void) | null = null;
    fetchMock.mockReturnValue(new Promise((resolve) => {
      release = () => resolve(jsonOk(payload({ totals: { "Member A": { points: 77, completions: 7 } } })));
    }));
    const { result } = renderUseAllTimeTotals();
    await settle(10);

    let joined: Promise<void> | null = null;
    await act(async () => {
      joined = result.current.refresh();
      await settle(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { release!(); });
    await act(async () => { await joined; });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.totals["Member A"].points).toBe(77);
  });
});

describe("familyAllTimePoints", () => {
  it("sums only when EVERY member total is known", () => {
    expect(familyAllTimePoints([45, 20, 0])).toBe(65);
    expect(familyAllTimePoints([45, null, 0])).toBeNull();
    expect(familyAllTimePoints([45, undefined])).toBeNull();
  });

  it("an empty roster is unknown, not zero", () => {
    expect(familyAllTimePoints([])).toBeNull();
  });
});
