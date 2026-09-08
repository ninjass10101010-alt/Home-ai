// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

import AiModelsCard from "@/components/settings/AiModelsCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  act(() => createRoot(el).render(ui));
  return el;
}

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
  stubFetch((url, init) => {
    if (url.endsWith("/api/ai/providers") && (!init?.method || init.method === "GET")) {
      return { providers: [provider], active: { provider: "b.ai free tier", model: "glm-5.3-flash" } };
    }
    if (url.endsWith("/api/ai/models")) {
      return { models: [{ id: "glm-5.3-flash" }, { id: "qwen3.8-flash" }] };
    }
    return { ok: true };
  });
});

afterEach(() => {
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

  it("marks the first model in the chain as In use", async () => {
    const el = render(<AiModelsCard />);
    await settle();

    expect(el.textContent).toContain("In use");
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
});
