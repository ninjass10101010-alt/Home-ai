// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

const eventsMock = vi.hoisted(() => ({ events: [] as any[] }));
const mealsMock = vi.hoisted(() => ({ meals: [] as any[] }));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: vi.fn(() => eventsMock.events),
    selectMeals: vi.fn(() => mealsMock.meals),
  },
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
  document.body.innerHTML = "";
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

const photoSpeaker = { name: "Emily Photo", emoji: PHOTO, color: "rose" };

describe("FamilyBrief photo speakers (the 'base64 letterings' leak)", () => {
  it("full card: renders the speaker as an <img>, never dumps the data URL as text", async () => {
    const el = render(<FamilyBrief speaker={photoSpeaker} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.textContent).not.toContain("data:image");
    expect(el.textContent).not.toContain("base64");
    expect(el.textContent).toContain("Emily");
  });

  it("signed-in identity card: renders the photo as an <img> too", async () => {
    const el = render(<FamilyBrief speaker={photoSpeaker} onDraft={vi.fn()} onSpeakerTap={vi.fn()} signedIn />);
    await act(async () => { await Promise.resolve(); });
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.textContent).not.toContain("base64");
  });

  it("compact strip: renders the photo as an <img>, keeps the name + dinner text", async () => {
    mealsMock.meals = [{ name: "Tacos", mealType: "dinner", time: localWeekdayShort(), weekOf: undefined }];
    const el = render(<FamilyBrief speaker={photoSpeaker} onDraft={vi.fn()} onSpeakerTap={vi.fn()} compact />);
    await act(async () => { await Promise.resolve(); });
    const strip = el.querySelector("[role='status']");
    expect(strip).not.toBeNull();
    const img = strip!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(strip!.textContent).toContain("Emily");
    expect(strip!.textContent).toContain("Tacos");
    expect(strip!.textContent).not.toContain("base64");
  });

  it("still renders plain-emoji speakers as text (no regression)", async () => {
    const el = render(<FamilyBrief speaker={{ name: "Rebecca", emoji: "🐱", color: "amber" }} onDraft={vi.fn()} onSpeakerTap={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(el.textContent).toContain("🐱");
    expect(el.querySelector("img")).toBeNull();
  });
});
