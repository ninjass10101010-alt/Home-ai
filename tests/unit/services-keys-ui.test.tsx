// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ currentUser: { role: "parent" as string } }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: mocks.currentUser }),
}));

import ServicesKeysCard from "@/components/settings/ServicesKeysCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG_BODY = {
  services: [
    {
      id: "themealdb",
      displayName: "TheMealDB",
      description: "Recipe catalog",
      testFnId: "themealdb",
      status: [
        { key: "MEALDB_KEY", label: "API key", helpText: "Default '1'", secret: false, required: false, set: false, source: "unset" },
      ],
    },
    {
      id: "telegram_alert",
      displayName: "Telegram Alerts",
      description: "Emergency push",
      testFnId: "telegram_alert",
      status: [
        { key: "TELEGRAM_BOT_TOKEN", label: "Bot token", helpText: "", secret: true, required: true, set: true, source: "db", preview: "xy" },
      ],
    },
  ],
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

beforeEach(() => {
  mocks.currentUser.role = "parent";
  localStorage.removeItem("consuela-connections");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ServicesKeysCard", () => {
  it("renders service rows with status and hides values for secrets", async () => {
    stubFetch(() => CONFIG_BODY);
    const el = render(<ServicesKeysCard />);

    await settle();

    expect(el.textContent).toContain("TheMealDB");
    expect(el.textContent).toContain("Telegram Alerts");
    // expand Telegram row — the suffix hint lives in the expanded field label
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Telegram Alerts")) b.click();
      });
    });
    await settle();

    expect(el.textContent).toContain("•••xy"); // suffix hint only
    expect(el.textContent).not.toContain("TELEGRAM_BOT_TOKEN_VALUE");
  });

  it("hides entirely for child sessions", async () => {
    mocks.currentUser.role = "child";
    stubFetch(() => CONFIG_BODY);
    const el = render(<ServicesKeysCard />);
    await settle();
    expect(el.textContent).toBe("");
  });

  it("saves a field via PUT with service/key/value", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/config") && (!init?.method || init.method === "GET")) {
          return { ok: true, json: async () => CONFIG_BODY };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      })
    );
    const el = render(<ServicesKeysCard />);
    await settle();

    // expand TheMealDB row
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("TheMealDB")) b.click();
      });
    });

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setNative.call(input, "9");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent === "Save") b.click();
      });
    });
    await settle();

    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(String(put!.init!.body))).toEqual({
      service: "themealdb",
      key: "MEALDB_KEY",
      value: "9",
    });
  });

  it("offers to import legacy keys and clears the blob afterwards", async () => {
    localStorage.setItem(
      "consuela-connections",
      JSON.stringify({ instacart: { apiKey: "legacy-ic" } })
    );
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/import")) {
          return { ok: true, json: async () => ({ ok: true, imported: 1, rejected: [] }) };
        }
        return { ok: true, json: async () => CONFIG_BODY };
      })
    );

    const el = render(<ServicesKeysCard />);
    await settle();

    expect(el.textContent).toContain("older version");
    act(() => {
      el.querySelectorAll("button").forEach((b) => {
        if (b.textContent === "Import") b.click();
      });
    });
    await settle();

    const post = calls.find((c) => String(c.url).includes("/import"));
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body)).entries[0]).toEqual({
      service: "instacart",
      key: "INSTACART_API_KEY",
      value: "legacy-ic",
    });
    expect(localStorage.getItem("consuela-connections")).toBeNull();
  });
});
