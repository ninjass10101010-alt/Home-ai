// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

import AiModelsCard from "@/components/settings/AiModelsCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The card hides mutating controls for non-parents; tests run as a parent by
// default — flip `mockAuth.isParent` inside a test to probe the kid view.
const mockAuth: { isParent: boolean; isLoggedIn: boolean; currentUser: { name: string; role: string } } = {
  isParent: true, isLoggedIn: true, currentUser: { name: "Jeff", role: "parent" },
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const provider = {
  id: "p1",
  displayName: "b.ai free tier",
  baseUrl: "https://api.b.ai",
  models: ["glm-5.3-flash", "qwen3.8-flash"],
  enabled: true,
  order: 0,
  keyPreview: "xz",
  status: "ok",
};

const provider2 = {
  id: "p2",
  displayName: "spare",
  baseUrl: "https://spare.ai",
  models: ["s-model"],
  enabled: true,
  order: 1,
  keyPreview: null,
  status: "unknown",
};

const healthEmpty = { outcomes: [], summary: { total: 0, ok: 0, wrapup: 0, exhausted: 0, snag: 0, clientGone: 0, unconfigured: 0, avgMs: 0, lastFailure: null } };

const healthSample = {
  outcomes: [
    { ts: Date.now() - 60_000, outcome: "exhausted", agent: "consuela", rounds: 6, ms: 21000, brain: "b.ai free tier/glm-5.3-flash", targets: 2 },
    { ts: Date.now() - 120_000, outcome: "ok", agent: "consuela", rounds: 1, ms: 1200, brain: "b.ai free tier/glm-5.3-flash", targets: 2 },
  ],
  summary: { total: 8, ok: 5, wrapup: 1, exhausted: 1, snag: 1, clientGone: 0, unconfigured: 0, avgMs: 3400, lastFailure: { ts: Date.now() - 60_000, outcome: "exhausted", agent: "consuela", rounds: 6, ms: 21000, brain: "b.ai free tier/glm-5.3-flash", targets: 2, reason: "model kept calling tools" } },
};

function stubFetch(respond: (url: string, init?: RequestInit) => any) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = respond(String(url), init);
      return { ok: true, status: 200, json: async () => body };
    })
  );
}

function render(ui: React.ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(ui));
  return el;
}

const roots: Array<{ unmount: () => void }> = [];

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function setInputValue(el: HTMLElement, input: HTMLInputElement, value: string) {
  const setNative = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setNative.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  stubFetch((url, init) => {
    if (url.endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
      return { providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } };
    }
    if (url.endsWith("/api/ai/models")) {
      return { models: [{ id: "glm-5.3-flash" }, { id: "qwen3.8-flash" }] };
    }
    if (url.endsWith("/api/ai/health")) {
      return healthEmpty;
    }
    return { ok: true };
  });
});

afterEach(() => {
  // Unmount every rendered root BEFORE wiping body — the confirm Modal portals
  // to document.body, so wiping innerHTML under a live root throws
  // "node to be removed is not a child of this node".
  for (const root of roots.splice(0)) {
    try { act(() => root.unmount()); } catch { /* already gone */ }
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AiModelsCard", () => {
  it("shows the currently loaded model chip from the provider store", async () => {
    const el = render(<AiModelsCard />);
    await settle();

    expect(el.textContent).toContain("Currently loaded: glm-5.3-flash · via b.ai free tier");
  });

  it("loads the model list from the server via POST /api/ai/models", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        return { ok: true, status: 200, json: async () => ({ models: [{ id: "glm-5.3-flash" }] }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    // open the draft editor
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Add provider")) b.click();
      });
    });
    await settle();

    // fill the base URL so Load models is enabled
    const inputs = el.querySelectorAll("input");
    const baseUrlInput = inputs[1] as HTMLInputElement;
    setInputValue(el, baseUrlInput, "https://api.b.ai/v1");

    await settle();
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Load models")) b.click();
      });
    });
    await settle();

    const post = calls.find((c) => c.url.endsWith("/api/ai/models"));
    expect(post).toBeTruthy();
    expect(post!.init?.method).toBe("POST");
    const body = JSON.parse(String(post!.init!.body));
    expect(body.baseUrl).toBe("https://api.b.ai/v1");
  });

  it("lists the provider's models as chips with Brain / Fallback roles", async () => {
    const el = render(<AiModelsCard />);
    await settle();

    // Both model ids are visible on the saved row (was: only a "2 model(s)" count)
    expect(el.textContent).toContain("glm-5.3-flash");
    expect(el.textContent).toContain("qwen3.8-flash");
    expect(el.textContent).toContain("Brain"); // first model = the brain
    expect(el.textContent).toContain("Fallback");
  });

  it("renders the env chain read-only (never editable/removable) and never lies about no brain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return {
            ok: true, status: 200, json: async () => ({
              providers: [],
              active: { provider: "fallback", model: "glm-5.3-flash" },
              envProviders: [{ provider: "fallback", baseUrl: "https://router.internal", models: ["glm-5.3-flash", "qwen3.8-flash"], keyPreview: "k1", readOnly: true }],
            }),
          };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    expect(el.textContent).toContain("Currently loaded: glm-5.3-flash · via fallback");
    expect(el.textContent).not.toContain("No brain configured");
    expect(el.textContent).toContain("read-only");
    expect(el.textContent).toContain("glm-5.3-flash");
    // Read-only rows get no Edit/Remove/Set-default controls
    const labels = [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "");
    expect(labels.some((l) => l.startsWith("Edit "))).toBe(false);
    expect(labels.some((l) => l.startsWith("Remove "))).toBe(false);
  });

  it("moves a model up the chain and persists the new model order via PUT", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({ provider: {} }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    const upBtn = [...el.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label") === "Move qwen3.8-flash up"
    );
    expect(upBtn).toBeTruthy();
    act(() => upBtn!.click());
    await settle();

    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put).toBeTruthy();
    const body = JSON.parse(String(put!.init!.body));
    expect(body.id).toBe("p1");
    expect(body.models).toEqual(["qwen3.8-flash", "glm-5.3-flash"]);
  });

  it("reorders providers (first provider becomes the brain) via PUT order", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider, provider2], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({ provider: {} }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    const upBtn = [...el.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label") === "Move spare up"
    );
    expect(upBtn).toBeTruthy();
    act(() => upBtn!.click());
    await settle();

    const puts = calls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(2); // both providers get their order swapped
    const bodies = puts.map((p) => JSON.parse(String(p.init!.body)));
    expect(bodies).toContainEqual(expect.objectContaining({ id: "p2", order: 0 }));
    expect(bodies).toContainEqual(expect.objectContaining({ id: "p1", order: 1 }));
  });

  it("asks before removing a provider (confirm modal) and deletes on confirm", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    const removeBtn = [...el.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label") === "Remove b.ai free tier"
    );
    expect(removeBtn).toBeTruthy();
    act(() => removeBtn!.click());
    await settle();

    // No DELETE yet — the confirm modal is showing (portaled to body)
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    expect(document.body.textContent).toContain("Remove b.ai free tier");

    const confirmBtn = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "Remove provider"
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => confirmBtn!.click());
    await settle();

    const del = calls.find((c) => c.init?.method === "DELETE");
    expect(del).toBeTruthy();
    expect(del!.url).toContain("id=p1");
  });

  it("does NOT delete when the confirm modal is cancelled", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    act(() => {
      [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Remove b.ai free tier")!.click();
    });
    await settle();
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel")!.click();
    });
    await settle();
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
  });

  it("Test button pings /v1/models and shows the result line", async () => {
    const el = render(<AiModelsCard />);
    await settle();

    const testBtn = [...el.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label") === "Test b.ai free tier"
    );
    expect(testBtn).toBeTruthy();
    await act(async () => testBtn!.click());
    await settle();

    expect(el.textContent).toContain("ok — 2 models");
  });

  it("pins the Brain badge to the FIRST ENABLED provider (a disabled row never wears it)", async () => {
    // Review finding (2026-09-16): the badge keyed on array index, so a
    // DISABLED first provider still read "Brain" while chat actually started
    // at the next enabled provider — the same settings-vs-reality lie class
    // this card rewrite exists to kill.
    const disabledFirst = { ...provider, id: "p0", displayName: "dead provider", baseUrl: "https://dead.example", enabled: false, status: "unknown", order: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [disabledFirst, provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthEmpty };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    const rows = [...el.querySelectorAll("div")].filter((d) =>
      d.className.includes("px-4 py-3") && d.querySelector("p")?.textContent?.includes("https://")
    );
    const deadRow = rows.find((d) => d.querySelector("p")?.textContent?.includes("dead.example"));
    const liveRow = rows.find((d) => d.querySelector("p")?.textContent?.includes("api.b.ai"));
    expect(deadRow).toBeTruthy();
    expect(liveRow).toBeTruthy();
    expect(deadRow!.textContent).not.toContain("Brain");
    expect(liveRow!.textContent).toContain("Brain");
  });

  it("hides all mutating controls from non-parent sessions (they'd 403)", async () => {
    mockAuth.isParent = false;
    mockAuth.currentUser.role = "child";
    const el = render(<AiModelsCard />);
    await settle();
    mockAuth.isParent = true; // restore before assertions that touch other state
    mockAuth.currentUser.role = "parent";

    // The chain is still visible…
    expect(el.textContent).toContain("glm-5.3-flash");
    expect(el.textContent).toContain("b.ai free tier");
    // …but every control that would hit an adult-gated write is absent.
    const labels = [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "");
    expect(labels.some((l) => l.startsWith("Edit "))).toBe(false);
    expect(labels.some((l) => l.startsWith("Remove "))).toBe(false);
    expect(labels.some((l) => l.startsWith("Test "))).toBe(false);
    expect(labels.some((l) => l.startsWith("Move "))).toBe(false);
    expect(el.textContent).not.toContain("Add provider");
  });

  it("shows the AI health panel with the outcome summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
          return { ok: true, status: 200, json: async () => ({ providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } }) };
        }
        if (String(url).endsWith("/api/ai/health")) return { ok: true, status: 200, json: async () => healthSample };
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );
    const el = render(<AiModelsCard />);
    await settle();

    expect(el.textContent).toContain("AI Health");
    expect(el.textContent).toContain("5 ok");
    expect(el.textContent).toContain("1 ran out of steps");
    expect(el.textContent).toContain("1 timeout");
  });

  it("shows an honest empty state when no providers are configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ providers: [], active: null }),
      }))
    );
    const el = render(<AiModelsCard />);
    await settle();

    expect(el.textContent).toContain("No brain configured");
    expect(el.textContent).toContain("Add provider");
  });

  it("after Load models, fetched ids render as toggle chips and tapping adds to the chain", async () => {
    const el = render(<AiModelsCard />);
    await settle();

    // open the draft editor
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Add provider")) b.click();
      });
    });
    await settle();

    // fill the base URL so Load models is enabled
    const inputs = el.querySelectorAll("input");
    const baseUrlInput = inputs[1] as HTMLInputElement;
    setInputValue(el, baseUrlInput, "https://api.b.ai/v1");

    await settle();
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Load models")) b.click();
      });
    });
    await settle();

    // the fetched ids appear as toggle chips
    expect(el.textContent).toContain("2 models available");
    const chipFor = (id: string) =>
      [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === id);
    expect(chipFor("glm-5.3-flash")).toBeTruthy();
    expect(chipFor("qwen3.8-flash")).toBeTruthy();

    // qwen was NOT in the auto-selected chain; tapping adds it to Models field
    const modelsInput = [...el.querySelectorAll("input")].find(
      (i) => i.value.includes("glm-5.3-flash")
    ) as HTMLInputElement;
    expect(modelsInput).toBeTruthy();
    expect(modelsInput.value).toBe("glm-5.3-flash");

    act(() => {
      chipFor("qwen3.8-flash")!.click();
    });
    await settle();

    const modelsInputAfter = [...el.querySelectorAll("input")].find(
      (i) => i.value.includes("qwen3.8-flash")
    ) as HTMLInputElement;
    expect(modelsInputAfter).toBeTruthy();
    expect(modelsInputAfter.value).toBe("glm-5.3-flash, qwen3.8-flash");
  });
});
