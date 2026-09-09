// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act pattern (see screensaver-board.test.tsx
// and use-wall-mode.test.tsx). The plan's testing-library assertions are
// mirrored 1:1 via aria-label/text queries; every behavioral assertion from
// the plan block is kept.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loginMock = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: loginMock }),
}));

import WallPinPad from "@/components/wall/WallPinPad";

const member = { name: "Aurora", emoji: "🌈" };

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
  loginMock.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe("WallPinPad", () => {
  it("renders the member header and a 4×3 keypad", () => {
    const el = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(el.textContent).toContain("Aurora");
    for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
      expect(buttonByLabel(el, key)).toBeTruthy();
    }
    expect(buttonByLabel(el, "Clear")).toBeTruthy();
    expect(buttonByLabel(el, "Backspace")).toBeTruthy();
  });

  it("signs in on a correct PIN and calls onSuccess", async () => {
    loginMock.mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    const el = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={onSuccess} />);
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(onSuccess).toHaveBeenCalled();
    expect(loginMock).toHaveBeenCalledWith("Aurora", "1234");
  });

  it("a wrong PIN shows the inline error and clears the dots", async () => {
    loginMock.mockResolvedValueOnce({ success: false, error: "Invalid PIN" });
    const el = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} />);
    for (const d of ["9", "9", "9", "9"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Wrong PIN — try again.");
    const dots = el.querySelector('[aria-label="0 of 4 digits entered"]');
    expect(dots).toBeTruthy();
    expect(dots!.textContent).not.toContain("●");
  });

  it("a network failure shows the honest unreachable copy", async () => {
    loginMock.mockRejectedValueOnce(new Error("offline"));
    const el = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} />);
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Couldn't reach Consuela — check the connection and try again.");
  });

  it("a resolved 'Network error' (useAuth's real failure shape) also shows the honest unreachable copy", async () => {
    loginMock.mockResolvedValueOnce({ success: false, error: "Network error" });
    const el = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} />);
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Couldn't reach Consuela — check the connection and try again.");
  });

  // ── onVerify seam (kid quest gate, spec §6 amendment) ──

  it("onVerify: 4 digits call onVerify with the code, success calls onSuccess, and login is NEVER called", async () => {
    const onVerify = vi.fn(async (pin: string) => ({ ok: true }));
    const onSuccess = vi.fn();
    const el = render(
      <WallPinPad member={member} onClose={vi.fn()} onSuccess={onSuccess} onVerify={onVerify} />
    );
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(onVerify).toHaveBeenCalledWith("1234");
    expect(onSuccess).toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("onVerify: a caller error string is shown verbatim and the dots clear", async () => {
    const onVerify = vi.fn(async () => ({ ok: false, error: "Wrong PIN. Try again." }));
    const el = render(
      <WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} onVerify={onVerify} />
    );
    for (const d of ["9", "9", "9", "9"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Wrong PIN. Try again.");
    const dots = el.querySelector('[aria-label="0 of 4 digits entered"]');
    expect(dots).toBeTruthy();
    expect(dots!.textContent).not.toContain("●");
  });

  it("onVerify: an undefined error falls back to the pad's Wrong PIN copy", async () => {
    const onVerify = vi.fn(async () => ({ ok: false }));
    const el = render(
      <WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} onVerify={onVerify} />
    );
    for (const d of ["9", "9", "9", "9"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Wrong PIN — try again.");
  });

  it("onVerify: a returned 'Network error' maps to the honest unreachable copy", async () => {
    const onVerify = vi.fn(async () => ({ ok: false, error: "Network error" }));
    const el = render(
      <WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} onVerify={onVerify} />
    );
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Couldn't reach Consuela — check the connection and try again.");
  });

  it("onVerify: a rejection maps to the honest unreachable copy", async () => {
    const onVerify = vi.fn(async () => {
      throw new Error("offline");
    });
    const el = render(
      <WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} onVerify={onVerify} />
    );
    for (const d of ["1", "2", "3", "4"]) act(() => buttonByLabel(el, d).click());
    await act(async () => {});
    expect(el.textContent).toContain("Couldn't reach Consuela — check the connection and try again.");
  });

  it("member.color threads to the Avatar (and defaults to green)", () => {
    const el = render(<WallPinPad member={{ ...member, color: "violet" }} onClose={vi.fn()} onSuccess={vi.fn()} />);
    const avatar = el.querySelector('[class*="bg-[var(--color-accent-violet)]"]');
    expect(avatar).not.toBeNull();

    const elDefault = render(<WallPinPad member={member} onClose={vi.fn()} onSuccess={vi.fn()} />);
    const avatarGreen = elDefault.querySelector('[class*="bg-[var(--color-accent-mint)]"]');
    expect(avatarGreen).not.toBeNull();
  });
});
