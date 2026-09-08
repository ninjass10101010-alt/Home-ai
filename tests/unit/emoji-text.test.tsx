// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { EmojiText, isPhotoEmoji, textEmojiOrFallback } from "@/components/ui/EmojiText";

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

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

describe("isPhotoEmoji", () => {
  it("detects data-URL and http photo avatars", () => {
    expect(isPhotoEmoji(PHOTO)).toBe(true);
    expect(isPhotoEmoji("https://example.com/me.jpg")).toBe(true);
    expect(isPhotoEmoji("http://example.com/me.jpg")).toBe(true);
  });

  it("passes plain emoji and empty values through as non-photos", () => {
    expect(isPhotoEmoji("🐱")).toBe(false);
    expect(isPhotoEmoji("")).toBe(false);
    expect(isPhotoEmoji(undefined)).toBe(false);
  });
});

describe("textEmojiOrFallback", () => {
  it("returns a text-safe emoji for photo values", () => {
    expect(textEmojiOrFallback(PHOTO)).toBe("👤");
    expect(textEmojiOrFallback("")).toBe("👤");
    expect(textEmojiOrFallback(undefined)).toBe("👤");
  });

  it("keeps plain emoji as-is", () => {
    expect(textEmojiOrFallback("🐱")).toBe("🐱");
  });
});

describe("EmojiText", () => {
  it("renders a plain emoji as text", () => {
    const el = render(<EmojiText emoji="🐱" alt="Rebecca" />);
    expect(el.textContent).toContain("🐱");
    expect(el.querySelector("img")).toBeNull();
  });

  it("renders a photo data-URL as an <img>, never as literal base64 text", () => {
    const el = render(<EmojiText emoji={PHOTO} alt="Emily" />);
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.textContent).not.toContain("data:image");
    expect(el.textContent).not.toContain("base64");
  });
});
