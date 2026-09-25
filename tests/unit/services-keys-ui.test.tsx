// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({
  auth: { hydrated: true as boolean | undefined, currentUser: { role: "parent" as string } },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  mocks.auth.hydrated = true;
  mocks.auth.currentUser.role = "parent";
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

  it("hides entirely for every non-parent role", async () => {
    for (const role of ["child", "pet", "guest", "Parent", ""]) {
      mocks.auth.currentUser.role = role;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const el = render(<ServicesKeysCard />);
      await settle();
      expect(el.textContent).toBe("");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("does not mount controls until auth hydration is explicitly true", async () => {
    mocks.auth.hydrated = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const el = render(<ServicesKeysCard />);
    await settle();

    expect(el.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("keeps a failed clear draft and reports the error", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/config") && (init?.method ?? "GET") === "GET") {
        return { ok: true, json: async () => CONFIG_BODY };
      }
      if (String(url).endsWith("/config") && init?.method === "DELETE") {
        return { ok: false, status: 500, json: async () => ({ ok: false, error: "delete_failed" }) };
      }
      return { ok: true, json: async () => ({ ok: true, detail: "configured" }) };
    }));
    const el = render(<ServicesKeysCard />);
    await settle();
    act(() => {
      el.querySelectorAll("button").forEach((button) => {
        if (button.textContent?.includes("Telegram Alerts")) button.click();
      });
    });
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => setInputValue(input, "replacement-secret"));
    await act(async () => {
      Array.from(el.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Use .env")?.click();
    });
    await settle();

    expect(input.value).toBe("replacement-secret");
    expect(el.textContent).toMatch(/clear|override|failed/i);
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(true);
  });

  it("disables field inputs and row controls while a save is pending", async () => {
    const pending = deferred<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>();
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/config") && (init?.method ?? "GET") === "GET") {
        return { ok: true, json: async () => CONFIG_BODY };
      }
      if (String(url).endsWith("/config") && init?.method === "PUT") return pending.promise;
      return { ok: true, json: async () => ({ ok: true, detail: "configured" }) };
    }));
    const el = render(<ServicesKeysCard />);
    await settle();
    act(() => {
      el.querySelectorAll("button").forEach((button) => {
        if (button.textContent?.includes("TheMealDB")) button.click();
      });
    });
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => setInputValue(input, "9"));
    await act(async () => {
      Array.from(el.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save")?.click();
    });

    expect(input.disabled).toBe(true);
    expect(Array.from(el.querySelectorAll("button")).find((button) => button.textContent?.includes("TheMealDB"))?.disabled).toBe(true);
    expect(Array.from(el.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Test")?.disabled).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ ok: true }) });
      await pending.promise;
    });
    await settle();
  });

  it("keeps controls disabled while an automatic test is pending", async () => {
    const testPending = deferred<any>();
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/config")) return { ok: true, json: async () => CONFIG_BODY };
      if (String(url).endsWith("/test")) return testPending.promise;
      return { ok: true, json: async () => ({ ok: true, detail: "configured" }) };
    }));
    const el = render(<ServicesKeysCard />);
    await settle();
    const rowButton = Array.from(el.querySelectorAll("button")).find((button) => button.textContent?.includes("TheMealDB"));
    expect(rowButton?.disabled).toBe(true);

    await act(async () => {
      testPending.resolve({ ok: true, json: async () => ({ ok: true, detail: "passed" }) });
      await testPending.promise;
    });
    await settle();
    expect(rowButton?.disabled).toBe(false);
  });

  it("includes rejected test entries in the result denominator", async () => {
    const body = {
      services: [
        {
          id: "one",
          displayName: "One",
          description: "",
          testFnId: "one",
          status: [{ key: "ONE_KEY", label: "One", helpText: "", secret: true, required: true, set: true, source: "db", preview: "xy" }],
        },
        {
          id: "two",
          displayName: "Two",
          description: "",
          testFnId: "two",
          status: [{ key: "TWO_KEY", label: "Two", helpText: "", secret: true, required: true, set: true, source: "db", preview: "xy" }],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/config")) return { ok: true, json: async () => body };
      if (String(url).endsWith("/test")) {
        const service = init?.body ? JSON.parse(String(init.body)).service : "";
        if (service === "two") return Promise.reject(new Error("test request failed"));
        return { ok: true, json: async () => ({ ok: true, detail: "passed" }) };
      }
      return { ok: true, json: async () => ({ ok: true, detail: "configured" }) };
    }));
    const el = render(<ServicesKeysCard />);
    await settle();

    expect(el.textContent).toMatch(/0\/2|1\/2|2\/2/);
    expect(el.textContent).not.toMatch(/1\/1 passed/);
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
