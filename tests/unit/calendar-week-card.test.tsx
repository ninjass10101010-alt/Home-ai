// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import ConsuelaWeekCard, { bufferToAddEventArgs } from "@/components/calendar/ConsuelaWeekCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Harness idiom copied from tests/unit/ledger-widget.test.tsx (role-gated
// widget) + home-suggestions-widget.test.tsx (createRoot + act + fetch stub).
let authState: { currentUser: any; isParent: boolean } = {
  currentUser: { name: "Rebecca", role: "parent" },
  isParent: true,
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

function findButton(container: ParentNode, re: RegExp): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    re.test(b.textContent ?? "")
  );
  if (!btn) throw new Error(`no button matching ${re} — DOM: ${container.textContent?.slice(0, 300)}`);
  return btn as HTMLButtonElement;
}

const PLAN = {
  conflicts: [{ title: "Soccer vs. dinner", message: "Overlaps pickup by 30 min" }],
  buffers: [{ title: "Drive to soccer", start: "2026-09-11T14:30", end: "2026-09-11T15:15" }],
  suggestions: ["Quiet Fri eve", "Move piano to Tue"],
};

type Call = { url: string; init?: any };

// fetch stub that routes by endpoint and RECORDS every call so tests can
// prove nothing (or exactly what) hit the network at each step.
function stubFetch(overrides: Partial<Record<"chat" | "verify" | "apply", (init?: any) => any>> = {}) {
  const calls: Call[] = [];
  const respond = (payload: unknown, status = 200) => ({
    ok: status >= 200 && status < 400,
    status,
    json: async () => payload,
  });
  const impl = vi.fn(async (input: RequestInfo | URL, init?: any) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/hermes/chat")) {
      return overrides.chat ? overrides.chat(init) : respond({ ok: true, intent: "schedule_week", result: PLAN });
    }
    if (url.includes("/api/members/verify")) {
      return overrides.verify ? overrides.verify(init) : respond({ success: true, member: { name: "Rebecca", role: "parent" } });
    }
    if (url.includes("/api/consuela/planner/apply")) {
      return overrides.apply ? overrides.apply(init) : respond({ ok: true, event: { id: "e1" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

async function reviewToOk(el: HTMLElement, calls: Call[]) {
  await act(async () => {
    findButton(el, /Review the week/i).click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function settle(ms = 250) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// Controlled-input typing idiom from tests/unit/kid-home-quest-pin-safety.tsx
// — the native setter first, else React's value tracker dedupes the event.
async function typePin(container: ParentNode, value: string) {
  const input = container.querySelector('input[type="password"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

beforeEach(() => {
  document.body.innerHTML = "";
  authState = { currentUser: { name: "Rebecca", role: "parent" }, isParent: true };
  // Shared Modal's exit path reads prefers-reduced-motion — jsdom has no
  // matchMedia (same stub idiom as emergency-modal.test.tsx).
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ConsuelaWeekCard — role gate + planner call", () => {
  it("renders NOTHING for child, guest and absent users, and never fetches", async () => {
    for (const state of [
      { currentUser: { name: "Caspian", role: "child" }, isParent: false },
      { currentUser: null, isParent: false },
    ]) {
      authState = state;
      const spy = vi.fn();
      vi.stubGlobal("fetch", spy);
      const el = render(<ConsuelaWeekCard />);
      await settle(0);
      expect(el.innerHTML).toBe("");
      expect(spy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("parent tap posts {agent:'planner', intent:'schedule_week'} and shows skeletons while in flight", async () => {
    let resolveChat: ((v: any) => void) | null = null;
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: any) => {
        calls.push({ url: String(input), init });
        return new Promise((r) => {
          resolveChat = r;
        })
      })
    );
    const el = render(<ConsuelaWeekCard />);
    await act(async () => {
      findButton(el, /Review the week/i).click();
    });
    // Loading state while the planner call is parked.
    expect(el.querySelector('[class*="animate-pulse"]')).not.toBeNull();
    resolveChat!({ ok: true, status: 200, json: async () => ({ ok: true, result: PLAN }) });
    await settle(0);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/api/hermes/chat");
    expect(JSON.parse(calls[0].init!.body)).toEqual({ agent: "planner", intent: "schedule_week" });
  });
});

describe("ConsuelaWeekCard — result rows + deep links", () => {
  it("ok result renders conflict, buffer window, suggestion lines and one Ask link per row", async () => {
    const calls = stubFetch();
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);
    expect(el.textContent).toContain("Soccer vs. dinner");
    expect(el.textContent).toContain("Overlaps pickup by 30 min");
    expect(el.textContent).toContain("Drive to soccer");
    expect(el.textContent).toContain("14:30");
    expect(el.textContent).toContain("15:15");
    expect(el.textContent).toContain("Quiet Fri eve");
    expect(el.textContent).toContain("Move piano to Tue");
    const askLinks = Array.from(el.querySelectorAll("a")).filter((a) =>
      (a.textContent ?? "").includes("Ask about this")
    );
    expect(askLinks.length).toBe(4); // 1 conflict + 1 buffer + 2 suggestions
    for (const a of askLinks) expect(a.getAttribute("href")).toMatch(/^\/chat\?q=.+/);
    expect(decodeURIComponent(askLinks[0].getAttribute("href")!)).toContain("Soccer vs. dinner");
  });

  it("all-empty result renders the honest calm week copy", async () => {
    const calls = stubFetch({
      chat: () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { conflicts: [], buffers: [], suggestions: [] } }) }),
    });
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);
    expect(el.textContent).toContain("No conflicts this week — the calendar looks calm.");
  });

  it("provider !ok renders honest error with Try again, which re-posts", async () => {
    let fail = true;
    const calls = stubFetch({
      chat: () =>
        fail
          ? { ok: true, status: 200, json: async () => ({ ok: false, reason: "provider_unavailable" }) }
          : { ok: true, status: 200, json: async () => ({ ok: true, result: PLAN }) },
    });
    const el = render(<ConsuelaWeekCard />);
    await act(async () => {
      findButton(el, /Review the week/i).click();
    });
    await settle(0);
    expect(el.textContent).toMatch(/reach|couldn/i);
    fail = false;
    await act(async () => {
      findButton(el, /Try again/i).click();
    });
    await settle(0);
    expect(el.textContent).toContain("Soccer vs. dinner");
    expect(calls.filter((c) => c.url.includes("/api/hermes/chat")).length).toBe(2);
  });
});

describe("ConsuelaWeekCard — PIN-gated apply", () => {
  it("opens the PIN modal WITHOUT posting anything; submit carries x-consuela-pin and flips the row to Added ✓", async () => {
    const calls = stubFetch();
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);

    await act(async () => {
      findButton(el, /Add to calendar/i).click();
    });
    // modal open, network silent (only the planner call so far)
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(calls.length).toBe(1);

    await typePin(document.body, "1234");
    await act(async () => {
      findButton(document.body, /^Submit$/).click();
    });
    await settle(0);

    const apply = calls.find((c) => c.url.includes("/api/consuela/planner/apply"));
    expect(apply).toBeTruthy();
    expect((apply!.init!.headers as Record<string, string>)["x-consuela-pin"]).toBe("1234");
    expect(JSON.parse(apply!.init!.body)).toEqual({
      tool: "add_event",
      args: { title: "Drive to soccer", date: "2026-09-11", time: "14:30" },
    });
    // toast + button flip + modal closed
    expect(document.body.textContent).toContain("Added to calendar");
    expect(findButton(el, /Added ✓/i).disabled).toBe(true);
    await settle(); // let the Modal exit animation finish
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("wrong PIN re-prompts (no apply POST)", async () => {
    const calls = stubFetch({
      verify: () => ({ ok: false, status: 401, json: async () => ({ error: "Invalid PIN" }) }),
    });
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);
    await act(async () => {
      findButton(el, /Add to calendar/i).click();
    });
    await typePin(document.body, "9999");
    await act(async () => {
      findButton(document.body, /^Submit$/).click();
    });
    await settle(0);
    expect(document.body.textContent).toContain("Wrong PIN. Try again.");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(calls.some((c) => c.url.includes("/api/consuela/planner/apply"))).toBe(false);
  });

  it("unreachable PIN server gets the honest copy, never 'Wrong PIN'", async () => {
    const calls = stubFetch({
      verify: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);
    await act(async () => {
      findButton(el, /Add to calendar/i).click();
    });
    await typePin(document.body, "1234");
    await act(async () => {
      findButton(document.body, /^Submit$/).click();
    });
    await settle(0);
    expect(document.body.textContent).toContain("Couldn't reach Consuela");
    expect(document.body.textContent).not.toContain("Wrong PIN");
    expect(calls.some((c) => c.url.includes("/api/consuela/planner/apply"))).toBe(false);
  });

  it("cancelling the modal clears the typed PIN (repo rule)", async () => {
    const calls = stubFetch();
    const el = render(<ConsuelaWeekCard />);
    await reviewToOk(el, calls);
    await act(async () => {
      findButton(el, /Add to calendar/i).click();
    });
    const pinInput = () => document.body.querySelector('input[type="password"]') as HTMLInputElement;
    await typePin(document.body, "1234");
    await act(async () => {
      findButton(document.body, /^Cancel$/).click();
    });
    await settle();
    await act(async () => {
      findButton(el, /Add to calendar/i).click();
    });
    expect(pinInput().value).toBe("");
    // still nothing sent but the planner call
    expect(calls.length).toBe(1);
  });
});

describe("bufferToAddEventArgs — pure mapping", () => {
  it("maps an ISO local start to add_event date + time", () => {
    expect(
      bufferToAddEventArgs({ title: "Drive to soccer", start: "2026-09-11T14:30", end: "2026-09-11T15:15" })
    ).toEqual({ title: "Drive to soccer", date: "2026-09-11", time: "14:30" });
  });

  it("tolerates a space separator and trims seconds", () => {
    expect(bufferToAddEventArgs({ title: "A", start: "2026-09-12 08:05", end: "x" }).time).toBe("08:05");
    expect(bufferToAddEventArgs({ title: "A", start: "2026-09-13T09:00:45", end: "x" }).time).toBe("09:00");
  });

  it("omits time for a bare date and keeps the title", () => {
    const args = bufferToAddEventArgs({ title: "All-day prep", start: "2026-09-14", end: "2026-09-14" });
    expect(args).toEqual({ title: "All-day prep", date: "2026-09-14" });
    expect("time" in args).toBe(false);
  });
});
