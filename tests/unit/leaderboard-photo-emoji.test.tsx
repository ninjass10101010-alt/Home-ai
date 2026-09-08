// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

import ShareCard from "@/components/leaderboard/ShareCard";
import TreasurePath from "@/components/leaderboard/TreasurePath";

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
});

describe("ShareCard photo member (champion share)", () => {
  it("renders the champion as an <img>, never the raw data URL as text", () => {
    const el = render(
      <ShareCard open memberName="Emily Photo" memberEmoji={PHOTO} rank={1} points={120} onClose={vi.fn()} />
    );
    // ShareCard portals via Modal — query the whole body.
    const img = document.body.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(document.body.textContent).not.toContain("data:image");
    expect(document.body.textContent).not.toContain("base64");
    // The champion is still named.
    expect(document.body.textContent).toContain("Emily");
  });

  it("share text swaps the photo for 👤 so the clipboard never receives base64", () => {
    const el = render(
      <ShareCard open memberName="Emily Photo" memberEmoji={PHOTO} rank={1} points={120} onClose={vi.fn()} />
    );
    const text = document.body.textContent || "";
    expect(text).not.toContain("base64");
    expect(text).toContain("👤 Emily is #1");
  });

  it("keeps plain emoji sharing as-is", () => {
    render(<ShareCard open memberName="Rebecca" memberEmoji="🐱" rank={1} points={120} onClose={vi.fn()} />);
    expect(document.body.textContent).toContain("🐱 Rebecca is #1");
  });
});

describe("TreasurePath photo member (current-level sparkle)", () => {
  it("renders the current-level marker as an <img> when the member has a photo avatar", () => {
    const el = render(<TreasurePath allTimePoints={30} memberEmoji={PHOTO} memberColor="rose" />);
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.textContent).not.toContain("base64");
  });

  it("keeps plain emoji members as text (no regression)", () => {
    const el = render(<TreasurePath allTimePoints={30} memberEmoji="🌱" memberColor="green" />);
    expect(el.textContent).toContain("🌱");
    expect(el.querySelector("img")).toBeNull();
  });
});
