// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act pattern (see wall-member-rail.test.tsx
// / wall-pin-pad.test.tsx). The plan's wall-chrome assertions are mirrored
// 1:1 via class queries; every behavioral assertion from the plan block is
// kept verbatim (h-[72px] capsule item, opacity-100 label, h-16/h-11 shield).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wallState = vi.hoisted(() => ({ wall: false, mounted: true }));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => wallState }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentUser: null }) }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

import CapsuleNav from "@/components/ui/CapsuleNav";
import EmergencyButton from "@/components/ui/EmergencyButton";

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

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe("wall chrome", () => {
  it("nav items are 72px with always-visible labels on the wall", () => {
    wallState.wall = true;
    const el = render(<CapsuleNav />);
    const item = el.querySelector(".capsule-item") as HTMLElement | null;
    expect(item).toBeTruthy();
    expect(item!.className).toContain("h-[72px]");
    const label = el.querySelector(".capsule-label-text") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.className).toContain("opacity-100");
    wallState.wall = false;
  });

  it("emergency shield is 64px on the wall, 44px elsewhere", () => {
    wallState.wall = true;
    const el = render(<EmergencyButton />);
    expect((el.querySelector("button") as HTMLButtonElement).className).toContain("h-16");
    act(() => {
      root?.unmount();
    });
    root = null;
    wallState.wall = false;
    const el2 = render(<EmergencyButton />);
    expect((el2.querySelector("button") as HTMLButtonElement).className).toContain("h-11");
  });
});
