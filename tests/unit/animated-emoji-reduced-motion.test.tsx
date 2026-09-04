// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import AnimatedEmoji from "@/components/ui/AnimatedEmoji";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let reduce = false;
vi.mock("@/hooks/useAnimationBudget", () => ({
  usePrefersReducedMotion: () => reduce,
}));

function render(ui: React.ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe("AnimatedEmoji reduced-motion", () => {
  beforeEach(() => { reduce = false; document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("applies the idle animation when motion is allowed", () => {
    const el = render(<AnimatedEmoji emoji="🐩" name="Rico" size="md" />);
    expect(el.innerHTML).toContain("poodleBounce");
  });

  it("renders the same artwork with NO animation when reduced motion is preferred", () => {
    reduce = true;
    const el = render(<AnimatedEmoji emoji="🐩" name="Rico" size="md" />);
    // keyframe name still appears in the <style> block, but no element gets an
    // inline `animation:` — assert the applied-style form is gone.
    expect(el.innerHTML).not.toContain("animation:poodleBounce");
    expect(el.innerHTML).not.toMatch(/animation:\s*wag/);
    // the artwork itself still renders
    expect(el.querySelector("svg")).not.toBeNull();
  });

  it("the text-emoji fallback also stops bouncing under reduced motion", () => {
    reduce = true;
    const el = render(<AnimatedEmoji emoji="🌟" name="Star" size="md" />);
    expect(el.innerHTML).not.toMatch(/animation:\s*popBounce/);
  });

  it("animated={false} opts out regardless of the media query", () => {
    reduce = false;
    const el = render(<AnimatedEmoji emoji="🐩" name="Rico" size="md" animated={false} />);
    expect(el.innerHTML).not.toMatch(/animation:\s*poodleBounce/);
  });
});
