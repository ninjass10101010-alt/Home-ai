// @vitest-environment jsdom
// Settings → Weekly prizes: the config side of the shared race surface.
// Three honesty fixes live here:
//   H · a prize's text could be saved EMPTY and then rendered as a nameless
//       gold-medal row (and still counted toward the podium-gap target);
//   I · `saving` was set and cleared inside one synchronous handler, so React
//       batched it and every `disabled={saving}` / "Saving…" was a dead state
//       — the real send state is the outbox's `counts.queued`;
//   J · both prize cards hardcoded the DARK amber (#f59e0b) while
//       `--color-accent-amber` is #d97706 in the light theme.
// Plus the pure `raceGap` cases for F (a 0-point member holding a prize rank).
//
// Harness note: no @testing-library/react — the createRoot + React-act shim
// this repo already uses (see weekly-prizes-card.test.tsx). This file is .ts, so
// elements are built with createElement rather than JSX.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";
import WeeklyPrizesCard from "@/components/settings/WeeklyPrizesCard";
import { raceGap, WEEKLY_PRIZES_KEY, DEFAULT_WEEKLY_PRIZES } from "@/lib/task-utils";
import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-command-store";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | { name: string; role: string } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const showToast = vi.fn();
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (!init?.body) {
    return { ok: true, status: 200, json: async () => ({ snapshot: null, reconciled: true }) } as any;
  }
  const command = JSON.parse(String(init.body));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      operationId: command.operationId,
      kind: "weekly-prizes",
      items: command.items,
      updatedAt: command.updatedAt,
      revision: { revision: "2", updatedAt: command.updatedAt },
      applied: true,
    }),
  } as any;
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(createElement(WeeklyPrizesCard, { showToast }));
  });
  return host;
}

function textInputs(el: HTMLElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[aria-label^="Prize"][aria-label$="text"]'));
}
function buttonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
}
function button(el: HTMLElement, label: string): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function seedPrizes(prizes: unknown[]) {
  localStorage.setItem(WEEKLY_PRIZES_KEY, JSON.stringify(prizes));
}
function fieldError(el: HTMLElement, rank: number): string {
  const input = textInputs(el).find((i) => i.getAttribute("aria-label") === `Prize ${rank} text`);
  return (input?.getAttribute("aria-describedby") ? el.querySelector(`#${input.getAttribute("aria-describedby")}`)?.textContent : "") || "";
}
function configCommandBodies(): any[] {
  return (fetchMock.mock.calls as any[])
    .filter(([url, init]: any[]) => String(url) === "/api/tasks/config" && init?.body)
    .map(([, init]: any[]) => JSON.parse(String(init.body)));
}

// The prize list is a queued outbox command: the click only enqueues, so the
// send (and the counters that describe it) settle on a later tick.
async function flush(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  mockAuth.currentUser = { name: "Rebecca", role: "parent" };
  fetchMock.mockClear();
  showToast.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as any);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  vi.unstubAllGlobals();
});

// ═══ H · an empty prize text cannot be saved ═════════════════════════════════
describe("H · a prize must never be saved nameless", () => {
  it("refuses to save when a prize's text is blank, with a field-level message", async () => {
    const el = mount();
    act(() => {
      typeInto(textInputs(el)[1], "   ");
    });

    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();

    // Nothing was even queued: a nameless prize must never reach the server.
    expect(configCommandBodies()).toHaveLength(0);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(fieldError(el, 2)).toContain("Add a prize");
    // The save never claimed to have happened.
    expect(showToast).not.toHaveBeenCalledWith("🏆 Saving the weekly prizes…");
  });

  it("the blank row keeps its place — ranks stay contiguous (nothing is silently dropped)", async () => {
    const el = mount();
    act(() => {
      typeInto(textInputs(el)[1], "  ");
    });
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();

    // The row is still there, still at its rank, and still editable — the save
    // was refused, not the row deleted (deleting it would re-pack the ranks and
    // move the rank contract).
    expect(textInputs(el)).toHaveLength(3);
    expect(textInputs(el).map((i) => i.getAttribute("aria-label"))).toEqual([
      "Prize 1 text",
      "Prize 2 text",
      "Prize 3 text",
    ]);
    expect(textInputs(el)[1].getAttribute("placeholder")).toBe("What does #2 win?");
    expect(button(el, "Remove prize 2")).not.toBeNull();
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("only the blank row is named in the error; the filled rows save normally", async () => {
    const el = mount();
    act(() => {
      typeInto(textInputs(el)[2], "");
    });
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();

    expect(fieldError(el, 3)).not.toBe("");
    expect(fieldError(el, 1)).toBe("");
    expect(fieldError(el, 2)).toBe("");
    expect(configCommandBodies()).toHaveLength(0);
  });

  it("clears the message as soon as the row is filled and saves", async () => {
    const el = mount();
    act(() => {
      typeInto(textInputs(el)[1], "   ");
    });
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    expect(fieldError(el, 2)).not.toBe("");

    act(() => {
      typeInto(textInputs(el)[1], "Chooses dessert");
    });
    expect(fieldError(el, 2)).toBe("");

    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();
    expect(configCommandBodies()).toHaveLength(1);
    expect(configCommandBodies()[0].items[1]).toMatchObject({ rank: 2, text: "Chooses dessert" });
  });

  it("an untouched list still saves (the defaults are never blank)", async () => {
    const el = mount();
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();
    expect(configCommandBodies()[0].items).toEqual(DEFAULT_WEEKLY_PRIZES);
  });

  it("the card never renders a nameless prize row itself", () => {
    // A catalog that arrives nameless (an older device, a hand-edited store)
    // must still show what the row is for, not an empty label.
    seedPrizes([
      { id: "p1", rank: 1, emoji: "🥇", text: "" },
      { id: "p2", rank: 2, emoji: "🥈", text: "Chooses dessert" },
      { id: "p3", rank: 3, emoji: "🥉", text: "+$2 allowance" },
    ]);
    const el = mount();
    const first = textInputs(el)[0];
    expect(first.value.trim().length).toBeGreaterThan(0);
  });
});

// ═══ I · the save control reflects the REAL queue state ══════════════════════
describe("I · the save button tracks the outbox, not a synchronous flag", () => {
  it("Save is not labelled “Saving…” in the committed render (there is no in-flight local state)", () => {
    const el = mount();
    expect(buttonByText(el, "Save prizes")).toBeTruthy();
    expect(buttonByText(el, "Saving…")).toBeUndefined();
  });

  it("the button is disabled and labelled while the command is genuinely in flight", async () => {
    const el = mount();
    // The server never answers: the command is queued and never acknowledged,
    // which IS the real in-flight state (the outbox counters drive it).
    fetchMock.mockImplementation(async () => new Promise(() => {}) as any);

    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush(20);

    const button = Array.from(el.querySelectorAll("button")).find((b) => /Sending/.test(b.textContent || ""));
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The in-flight banner is showing too (queued, retrying or reconciling).
    expect(el.querySelector("[data-testid='prizes-command-queue']")!.textContent).toMatch(/Sending|Finishing up/);
  });

  it("the editable rows are locked only while something is queued", async () => {
    const el = mount();
    expect(textInputs(el)[0].disabled).toBe(false);

    fetchMock.mockImplementation(async () => new Promise(() => {}) as any);
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush(20);
    expect(textInputs(el)[0].disabled).toBe(true);
    expect(button(el, "Remove prize 1")!.disabled).toBe(true);
    expect(buttonByText(el, "Add prize")).toBeUndefined();
  });

  it("a refused send keeps the edit queued and never claims it saved", async () => {
    const el = mount();
    const before = localStorage.getItem(WEEKLY_PRIZES_KEY);
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));
    act(() => {
      buttonByText(el, "Save prizes")!.click();
    });
    await flush();

    // The command is still the outbox's to retry (a network refusal is
    // retryable, never a silent loss) and nothing claimed success.
    expect(listTaskOutbox()).toHaveLength(1);
    expect(el.querySelector("[data-testid='prizes-command-queue']")).not.toBeNull();
    expect(localStorage.getItem(WEEKLY_PRIZES_KEY)).toBe(before);
    expect(showToast).not.toHaveBeenCalledWith("🏆 Weekly prizes saved");
  });
});

// ═══ J · token-only colour in both prize cards ══════════════════════════════
describe("J · the prize cards use the amber token, not a raw hex", () => {
  const FILES = [
    "src/components/settings/WeeklyPrizesCard.tsx",
    "src/components/leaderboard/PrizeRaceCard.tsx",
  ];

  it("neither prize card hardcodes #f59e0b (the dark-theme value)", () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toContain("#f59e0b");
    }
  });

  it("both pass tone=\"var(--color-accent-amber)\" so the light theme follows", () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).toContain('tone="var(--color-accent-amber)"');
    }
  });

  it("no raw hex colour survives anywhere in these two files", () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const hexes = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      expect(hexes, file).toEqual([]);
    }
  });

  it("the token really is two different colours (so the hex was never equivalent)", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const amber = [...css.matchAll(/--color-accent-amber:\s*(#[0-9a-fA-F]+)/g)].map((m) => m[1]);
    expect(new Set(amber).size).toBeGreaterThan(1);
  });
});

// ═══ F (pure) · raceGap reports a 0-point member's real prize rank ═══════════
describe("F · raceGap ranks a 0-point member honestly", () => {
  it("a 0-point member behind a 2-way tie still holds its competition rank (1 + 2 = 3)", () => {
    const gap = raceGap("Bailey", { Rebecca: 100, Caspian: 100, Bailey: 0 });
    expect(gap.rank).toBe(3);
    // Holding no points means holding no prize — the card's holder math agrees
    // (it requires points > 0), and so does the podium ribbon.
    expect(gap.onPodium).toBe(false);
    // The rank-2 prize has NO holder under a 2-way tie, so there is no
    // threshold to name a distance to: null, never a fabricated number.
    expect(gap.gapToPodium).toBeNull();
  });

  it("a 0-point member behind three point-scorers is rank 4, off-podium", () => {
    const gap = raceGap("Bailey", { Rebecca: 100, Caspian: 90, Emily: 80, Bailey: 0 });
    expect(gap).toEqual({
      rank: 4,
      onPodium: false,
      gapToPodium: 80,
      leader: { name: "Rebecca", points: 100 },
    });
  });

  it("an all-zero week reports no rank at all — nobody has earned a placing", () => {
    // The short-circuit stays for the week that has not started: there is no
    // race to be ranked in, which is why the podium/YourCard suppress their
    // champion treatment on exactly this data.
    expect(raceGap("Bailey", { Rebecca: 0, Bailey: 0 })).toEqual({
      rank: null,
      onPodium: false,
      gapToPodium: null,
      leader: null,
    });
  });

  it("an empty week still reports no rank (nothing to rank)", () => {
    expect(raceGap("Rebecca", {})).toEqual({ rank: null, onPodium: false, gapToPodium: null, leader: null });
  });

  it("a member who is not on the board at all reports no rank", () => {
    expect(raceGap("Nobody", { Rebecca: 10 })).toEqual({
      rank: null,
      onPodium: false,
      gapToPodium: 10,
      leader: { name: "Rebecca", points: 10 },
    });
  });

  it("still returns every field of the RaceGap shape (the contract is the return type)", () => {
    const gap = raceGap("Rebecca", { Rebecca: 10, Emily: 5 });
    expect(Object.keys(gap).sort()).toEqual(["gapToPodium", "leader", "onPodium", "rank"]);
  });

  it("is pure — the same input always yields the same output", () => {
    const map = { Rebecca: 100, Caspian: 100, Bailey: 0 };
    expect(raceGap("Bailey", map)).toEqual(raceGap("Bailey", map));
    // And it does not mutate the caller's map.
    expect(map).toEqual({ Rebecca: 100, Caspian: 100, Bailey: 0 });
  });
});