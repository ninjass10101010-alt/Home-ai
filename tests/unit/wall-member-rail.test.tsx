// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act pattern (see wall-pin-pad.test.tsx).
// The plan's testing-library assertions are mirrored 1:1 via aria-label
// queries; every behavioral assertion from the plan block is kept.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import WallMemberRail from "@/components/wall/WallMemberRail";

const members = [
  { name: "Rebecca", emoji: "🐱", color: "green", avatarSize: "md", glow: false },
  { name: "Aurora", emoji: "🌈", color: "violet", avatarSize: "md", glow: false },
  { name: "Caspian", emoji: "🧒", color: "cyan", avatarSize: "md", glow: false },
];

let root: Root | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
  return el;
}

function buttonByLabel(el: HTMLElement, name: string): HTMLButtonElement {
  const btn = el.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`Missing button aria-label="${name}"`);
  return btn;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe("WallMemberRail", () => {
  it("renders one large tile per member", () => {
    const el = render(
      <WallMemberRail
        members={members as any}
        currentUser={null}
        isLoggedIn={false}
        onPick={vi.fn()}
        onSelfProfile={vi.fn()}
        onSignOut={vi.fn()}
      />
    );
    for (const m of members) {
      expect(buttonByLabel(el, `Sign in as ${m.name}`)).toBeTruthy();
    }
  });

  it("tapping a signed-out member calls onPick", () => {
    const onPick = vi.fn();
    const el = render(
      <WallMemberRail members={members as any} currentUser={null} isLoggedIn={false}
        onPick={onPick} onSelfProfile={vi.fn()} onSignOut={vi.fn()} />
    );
    act(() => buttonByLabel(el, "Sign in as Aurora").click());
    expect(onPick).toHaveBeenCalledWith(members[1]);
  });

  it("highlights the signed-in member and opens their profile on tap", () => {
    const onSelfProfile = vi.fn();
    const el = render(
      <WallMemberRail members={members as any} currentUser={{ name: "Rebecca" } as any} isLoggedIn={true}
        onPick={vi.fn()} onSelfProfile={onSelfProfile} onSignOut={vi.fn()} />
    );
    const self = buttonByLabel(el, "Open your profile");
    expect(self.getAttribute("aria-current")).toBe("true");
    act(() => self.click());
    expect(onSelfProfile).toHaveBeenCalled();
  });

  it("sign-out is a two-tap inline confirm", () => {
    const onSignOut = vi.fn();
    const el = render(
      <WallMemberRail members={members as any} currentUser={{ name: "Rebecca" } as any} isLoggedIn={true}
        onPick={vi.fn()} onSelfProfile={vi.fn()} onSignOut={onSignOut} />
    );
    const btn = buttonByLabel(el, "Sign out");
    act(() => btn.click());
    expect(onSignOut).not.toHaveBeenCalled(); // first tap arms
    act(() => buttonByLabel(el, "Confirm sign out").click());
    expect(onSignOut).toHaveBeenCalled();
  });
});
