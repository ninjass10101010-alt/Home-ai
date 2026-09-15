// @vitest-environment jsdom
//
// Settings → MUSE API card (Task 12). Backend routes are adult-gated; the card
// reads GET /api/muse/settings + /api/muse/log and drives PUT /api/muse/settings,
// POST /api/muse/settings/rotate and POST /api/muse/settings/revoke-tokens.
// fetch is mocked; no PocketBase is contacted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import MuseApiCard from "@/components/settings/MuseApiCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; init?: RequestInit };

const BASE_SETTINGS = {
  ok: true as const,
  enabled: false,
  adminEnabled: false,
  keyPrefix: null as string | null,
  version: 0,
  createdAt: null as string | null,
  rotatedAt: null as string | null,
  lastUsedAt: null as string | null,
  rateLimitPerMin: 120,
  hasKey: false,
};

function jsonRes(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

let calls: Call[] = [];
let root: Root | null = null;

function render(ui: React.ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(ui));
  return el;
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function clickByText(scope: HTMLElement, text: string) {
  const target = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.includes(text) || b.getAttribute("aria-label")?.includes(text)
  );
  if (!target) throw new Error(`no button matching "${text}"`);
  act(() => target.click());
}

function checkbox(el: HTMLElement, label: string): HTMLInputElement {
  const input = el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`no checkbox labeled "${label}"`);
  return input;
}

/** Controlled-input write via the native setter + React's `input` listener. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rateInput(el: HTMLElement): HTMLInputElement {
  const input = el.querySelector("#muse-rate") as HTMLInputElement | null;
  if (!input) throw new Error("no #muse-rate input");
  return input;
}

function ratePuts(): Call[] {
  return calls.filter(
    (c) => c.init?.method === "PUT" && String(c.init.body ?? "").includes("rateLimitPerMin")
  );
}

/** Stateful fetch stub: rotate flips hasKey, PUT merges the patch. */
function makeHandler(opts: { settings?: Partial<typeof BASE_SETTINGS>; entries?: any[] } = {}) {
  const state = {
    settings: { ...BASE_SETTINGS, ...opts.settings },
    entries: opts.entries ?? [],
  };
  const handler = (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/settings/rotate") && method === "POST") {
      state.settings = { ...state.settings, hasKey: true, keyPrefix: "muse_sec", version: state.settings.version + 1 };
      return jsonRes({ ok: true, key: "muse_secretkey_value", keyPrefix: "muse_sec", version: state.settings.version });
    }
    if (url.includes("/settings/revoke-tokens") && method === "POST") {
      state.settings = { ...state.settings, version: state.settings.version + 1 };
      return jsonRes({ ok: true, version: state.settings.version });
    }
    if (url.includes("/api/muse/settings") && method === "PUT") {
      state.settings = { ...state.settings, ...JSON.parse(String(init?.body)) };
      return jsonRes({ ...state.settings });
    }
    if (url.includes("/api/muse/log")) return jsonRes({ ok: true, entries: state.entries });
    if (url.includes("/api/muse/settings")) return jsonRes({ ...state.settings });
    return jsonRes({ ok: true });
  };
  return { handler, state };
}

function stub(handler: (url: string, init?: RequestInit) => any) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    })
  );
}

function lastPut(): Call {
  return [...calls].reverse().find((c) => c.init?.method === "PUT")!;
}

beforeEach(() => {
  calls = [];
  // The shared Modal's exit phase reads matchMedia (reduced-motion check).
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("MuseApiCard", () => {
  it("renders the header, both toggles, admin OFF by default, and the warning copy", async () => {
    stub(makeHandler().handler);
    const el = render(<MuseApiCard />);
    await settle();

    expect(el.textContent).toContain("MUSE API");
    expect(el.textContent).toContain("Let an external agent connect to the dashboard with its own login");

    const enabled = checkbox(el, "Enabled");
    const admin = checkbox(el, "Allow admin operations");
    expect(enabled.checked).toBe(false);
    expect(admin.checked).toBe(false);
    expect(el.textContent).toContain("update or restart the dashboard containers");

    // No key yet → honest empty state + Generate.
    expect(el.textContent).toContain("No key yet");
    expect(el.textContent).toContain("Generate key");
  });

  it("Generate posts rotate, shows the key once, then clears it on refetch", async () => {
    stub(makeHandler().handler);
    const el = render(<MuseApiCard />);
    await settle();

    clickByText(el, "Generate key");
    await settle();

    const rotate = calls.find((c) => c.url.includes("/settings/rotate"));
    expect(rotate).toBeTruthy();
    expect(rotate!.init?.method).toBe("POST");
    expect(el.textContent).toContain("muse_secretkey_value");
    expect(el.textContent).toContain("Save this now — it will not be shown again.");

    // Any refetch (here: a settings toggle) must never re-show the plaintext.
    act(() => checkbox(el, "Enabled").click());
    await settle();

    expect(el.textContent).not.toContain("muse_secretkey_value");
    expect(el.textContent).toContain("Rotate key");
  });

  it("PUTs the right bodies for the enabled and admin toggles", async () => {
    stub(makeHandler().handler);
    const el = render(<MuseApiCard />);
    await settle();

    act(() => checkbox(el, "Enabled").click());
    await settle();
    expect(JSON.parse(String(lastPut().init!.body))).toEqual({ enabled: true });

    act(() => checkbox(el, "Allow admin operations").click());
    await settle();
    expect(JSON.parse(String(lastPut().init!.body))).toEqual({ adminEnabled: true });
  });

  it("opens a confirm before revoking and only POSTs after confirming", async () => {
    stub(makeHandler({ settings: { hasKey: true, keyPrefix: "muse_sec", version: 1 } }).handler);
    const el = render(<MuseApiCard />);
    await settle();

    clickByText(el, "Revoke tokens");
    await settle();

    expect(document.body.textContent).toContain("signs out");
    expect(document.body.textContent).toContain("keeps the same");
    expect(calls.some((c) => c.url.includes("/settings/revoke-tokens"))).toBe(false);

    clickByText(document.body, "Sign out agents");
    await settle();

    const revoke = calls.find((c) => c.url.includes("/settings/revoke-tokens"));
    expect(revoke).toBeTruthy();
    expect(revoke!.init?.method).toBe("POST");
  });

  it("renders recent activity rows and the failure count", async () => {
    stub(
      makeHandler({
        entries: [
          {
            at: new Date().toISOString(),
            kind: "login",
            keyPrefix: "muse_sec",
            tool: null,
            ok: true,
            ms: 12,
            ip: "10.0.0.5",
            detail: "key login",
            tokenAdmin: false,
          },
          {
            at: new Date().toISOString(),
            kind: "tool",
            keyPrefix: "muse_sec",
            tool: "restart_container",
            ok: false,
            ms: 5,
            ip: "10.0.0.5",
            detail: "boom",
            tokenAdmin: true,
          },
        ],
      }).handler
    );
    const el = render(<MuseApiCard />);
    await settle();

    expect(el.textContent).toContain("Recent activity");
    expect(el.textContent).toContain("restart_container");
    expect(el.textContent).toContain("login");
    expect(el.textContent).toContain("1 of 2 recent calls failed.");
  });

  it("shows an honest adults-only state on a 403 instead of crashing", async () => {
    stub(() => jsonRes({ ok: false, error: "adult_only" }, false, 403));
    const el = render(<MuseApiCard />);
    await settle();

    expect(el.textContent).toContain("Only a parent can manage MUSE");
    expect(el.querySelector("button")).toBeTruthy();
  });

  it("surfaces honest copy when the settings fetch fails", async () => {
    stub(() => {
      throw new Error("network down");
    });
    const el = render(<MuseApiCard />);
    await settle();

    expect(el.textContent).toContain("Couldn't reach the MUSE settings");
    expect(el.textContent).toContain("Try again");
  });

  it("blank rate does not POST and shows an inline validation message", async () => {
    stub(makeHandler({ settings: { hasKey: true, keyPrefix: "muse_sec", version: 1 } }).handler);
    const el = render(<MuseApiCard />);
    await settle();

    setInputValue(rateInput(el), "");
    clickByText(el, "Save limit");
    await settle();

    expect(ratePuts()).toHaveLength(0);
    expect(el.textContent).toContain("Enter a number between 10 and 600");
  });

  it("out-of-range rate does not POST and shows range feedback", async () => {
    stub(makeHandler({ settings: { hasKey: true, keyPrefix: "muse_sec", version: 1 } }).handler);
    const el = render(<MuseApiCard />);
    await settle();

    setInputValue(rateInput(el), "5");
    clickByText(el, "Save limit");
    await settle();

    expect(ratePuts()).toHaveLength(0);
    expect(el.textContent).toContain("Enter a number between 10 and 600");
  });

  it("still renders the revealed key when the post-rotate refetch fails", async () => {
    let rotated = false;
    stub((url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/settings/rotate") && method === "POST") {
        rotated = true;
        return jsonRes({ ok: true, key: "muse_orphan_key", keyPrefix: "muse_orph" });
      }
      if (url.includes("/api/muse/log")) return jsonRes({ ok: true, entries: [] });
      if (url.includes("/api/muse/settings") && rotated) {
        return jsonRes({ ok: false, error: "boom" }, false, 500);
      }
      if (url.includes("/api/muse/settings")) {
        return jsonRes({ ...BASE_SETTINGS, hasKey: true, keyPrefix: "muse_sec", version: 1 });
      }
      return jsonRes({ ok: true });
    });
    const el = render(<MuseApiCard />);
    await settle();

    clickByText(el, "Rotate key");
    await settle();

    expect(el.textContent).toContain("Couldn't reach the MUSE settings");
    expect(el.textContent).toContain("muse_orphan_key");
    expect(el.textContent).toContain("Save this now — it will not be shown again.");
  });

  it("clears a previously revealed key on a successful settings mutation", async () => {
    stub(makeHandler({ settings: { hasKey: true, keyPrefix: "muse_sec", version: 1 } }).handler);
    const el = render(<MuseApiCard />);
    await settle();

    clickByText(el, "Rotate key");
    await settle();
    expect(el.textContent).toContain("muse_secretkey_value");

    act(() => checkbox(el, "Enabled").click());
    await settle();

    expect(el.textContent).not.toContain("muse_secretkey_value");
  });

  it("clears a previously revealed key when a rate save succeeds", async () => {
    stub(makeHandler({ settings: { hasKey: true, keyPrefix: "muse_sec", version: 1 } }).handler);
    const el = render(<MuseApiCard />);
    await settle();

    clickByText(el, "Rotate key");
    await settle();
    expect(el.textContent).toContain("muse_secretkey_value");

    setInputValue(rateInput(el), "200");
    clickByText(el, "Save limit");
    await settle();

    expect(ratePuts()).toHaveLength(1);
    expect(el.textContent).not.toContain("muse_secretkey_value");
  });
});
