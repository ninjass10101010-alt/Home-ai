// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Expose the events mock so live-refresh tests can swap the data.
const eventsMock = vi.hoisted(() => ({ events: [
  { id: "e1", title: "Soccer", time: "4:00 PM", member: "Caspian", emoji: "🧒" },
] as any[] }));

vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => [
      { name: "Rebecca", emoji: "🐱", color: "amber" },
      { name: "Caspian", emoji: "🧒", color: "mint" },
    ]),
    selectTodaysEvents: vi.fn(() => eventsMock.events),
    selectMeals: vi.fn(() => mealsMock.meals),
  },
}));

const mealsMock = vi.hoisted(() => ({ meals: [] as any[] }));
vi.mock("@/hooks/useMeals", () => ({
  useMeals: () => ({ meals: mealsMock.meals }),
}));

import { FamilyBrief } from "@/app/chat/FamilyBrief";
import { localWeekdayShort } from "@/lib/local-date";

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

beforeEach(() => {
  mealsMock.meals = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("FamilyBrief", () => {
  it("renders three brief cards: dinner, next up, speaker", () => {
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    expect(el.textContent).toContain("Dinner");
    expect(el.textContent).toContain("Next");
    expect(el.textContent).toContain("Rebecca");
  });

  it("shows tonight's dinner from the meal plan and drafts a dinner question on tap", async () => {
    mealsMock.meals = [{ name: "Tacos", mealType: "dinner", time: localWeekdayShort(), weekOf: undefined }];
    const onDraft = vi.fn();
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={onDraft} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("Tacos");
    const dinnerCard = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Tacos"))!;
    act(() => { dinnerCard.click(); });
    expect(onDraft).toHaveBeenCalledWith(expect.stringContaining("dinner"));
  });

  it("is honest when no dinner is planned — no invented meal", async () => {
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("Nothing planned yet");
  });

  it("shows today's next upcoming event", async () => {
    // `selectTodaysEvents` is mocked to return Soccer at 4:00 PM; the component
    // filters by current time — pin Date so 4 PM is still ahead.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T10:00:00"));
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("Soccer");
    vi.useRealTimers();
  });

  it("says the rest of the day is quiet when all events are past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T20:00:00"));
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    expect(el.textContent).toContain("Quiet rest of day");
    vi.useRealTimers();
  });

  it("opens the speaker picker from the speaker card", () => {
    const onSpeakerTap = vi.fn();
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={onSpeakerTap} />);
    const speakerCard = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Rebecca"))!;
    act(() => { speakerCard.click(); });
    expect(onSpeakerTap).toHaveBeenCalledTimes(1);
  });

  it("renders the speaker card read-only for signed-in members (no dead-end picker)", () => {
    const onSpeakerTap = vi.fn();
    const el = render(
      <FamilyBrief
        speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }}
        onDraft={vi.fn()}
        onSpeakerTap={onSpeakerTap}
        signedIn
      />
    );
    // The card still identifies the speaker…
    expect(el.textContent).toContain("Rebecca");
    // …but it is no longer a button — there is nothing to switch to.
    const speakerButtons = Array.from(el.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Rebecca") || b.getAttribute("aria-label")?.includes("switch")
    );
    expect(speakerButtons).toEqual([]);
    act(() => { el.click(); });
    expect(onSpeakerTap).not.toHaveBeenCalled();
  });

  it("never fires a one-tap write — every tap goes through onDraft", () => {
    mealsMock.meals = [{ name: "Tacos", mealType: "dinner", time: localWeekdayShort(), weekOf: undefined }];
    const onDraft = vi.fn();
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={onDraft} onSpeakerTap={vi.fn()} />);
    for (const b of Array.from(el.querySelectorAll("button"))) {
      act(() => { b.click(); });
    }
    // onDraft calls only ever carry draft text (strings), never sent anywhere
    for (const call of onDraft.mock.calls) {
      expect(typeof call[0]).toBe("string");
    }
  });

  it("shows a live countdown when the next event is under 90 minutes out", async () => {
    vi.useFakeTimers();
    const now = new Date();
    now.setHours(17, 30, 0, 0); // 5:30 PM
    vi.setSystemTime(now);
    eventsMock.events = [{ id: "e1", title: "Soccer", time: "6:00 PM", member: "Caspian", emoji: "🧒" }];
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("in 30m");
    vi.useRealTimers();
  });

  it("re-reads the family data when the 60s cache refresher fires (dinner logged mid-session flips the card)", async () => {
    mealsMock.meals = [];
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("Nothing planned yet");
    // A family member logs dinner on another device; CacheRefresher fires.
    mealsMock.meals = [{ name: "Tacos", mealType: "dinner", time: localWeekdayShort(), weekOf: undefined }];
    await act(async () => {
      document.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await Promise.resolve();
    });
    expect(el.textContent).toContain("Tacos");
  });
});
