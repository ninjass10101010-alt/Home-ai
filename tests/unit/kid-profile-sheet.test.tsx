// @vitest-environment jsdom
// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + act pattern (see wall-pin-pad.test.tsx). Queries
// run against document.body because the shared Modal portals its overlay
// there (the modal-portal contract). The 9-test contract is the plan's
// Task 2 block mirrored 1:1.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const logoutMock = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    logout: logoutMock,
    currentUser: { id: "m-aurora", name: "Aurora", role: "child", emoji: "🌈", color: "violet" },
  }),
}));

import KidProfileSheet from "@/components/modes/kid/KidProfileSheet";

const member = { name: "Aurora Rivera", color: "violet", emoji: "🌈", avatarSize: "md", glow: false };

let root: Root | null = null;
const fetchMock = vi.fn();

function render(ui: ReactElement): void {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
}

function dialog(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]');
  if (!el) throw new Error("KidProfileSheet dialog not mounted");
  return el as HTMLElement;
}

function emojiCell(emoji: string): HTMLButtonElement {
  // Attribute-value selectors can't match astral-plane emoji (🥳 is a UTF-16
  // surrogate pair — jsdom/nwsapi misses them), so match via getAttribute.
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === `Choose ${emoji}`,
  );
  if (!btn) throw new Error(`Missing emoji cell aria-label="Choose ${emoji}"`);
  return btn;
}

function sizeButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find(
    (b) => b.textContent === label,
  );
  if (!btn) throw new Error(`Missing size button "${label}"`);
  return btn;
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`Missing button "${text}"`);
  return btn;
}

function lastPostBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("no fetch call recorded");
  return JSON.parse(String(call[1].body));
}

beforeEach(() => {
  document.body.innerHTML = "";
  logoutMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("KidProfileSheet", () => {
  it("renders the identity zone: name, points line, and the avatar picker", () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} points={13} />);
    const d = dialog();
    expect(d.textContent).toContain("Aurora");
    expect(d.textContent).toContain("13 points this week");
    expect(d.textContent).toContain("you're on a roll");
    expect(emojiCell("🥳")).toBeTruthy();
  });

  it("picking an emoji updates the preview live and POSTs { patch: { emoji } } with NO actorName/actorPin anywhere", async () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    const cell = emojiCell("🥳");
    act(() => cell.click());
    // preview reflects the pick immediately (grid cell selected state)
    expect(cell.className).toContain("bg-[var(--color-accent-selected)]");
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/members/profile");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ patch: { emoji: "🥳" } });
    expect("actorName" in body).toBe(false);
    expect("actorPin" in body).toBe(false);
    expect("actorName" in body.patch).toBe(false);
    expect("actorPin" in body.patch).toBe(false);
  });

  it("on a 401 the sheet shows 'Parents change this in Settings.' and the preview REVERTS", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Avatar fields only on a child session" }),
    });
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    const cell = emojiCell("🥳");
    act(() => cell.click());
    expect(cell.className).toContain("bg-[var(--color-accent-selected)]");
    await act(async () => {});
    expect(dialog().textContent).toContain("Parents change this in Settings.");
    expect(cell.className).not.toContain("bg-[var(--color-accent-selected)]");
  });

  it("size pills render Tiny/Small/Medium/Large and picking one POSTs { patch: { avatarSize } } with no PIN", async () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    for (const label of ["Tiny", "Small", "Medium", "Large"]) expect(sizeButton(label)).toBeTruthy();
    act(() => sizeButton("Large").click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastPostBody()).toEqual({ patch: { avatarSize: "lg" } });
  });

  it("the glow toggle POSTs { patch: { glow: true } }", async () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    const toggle = document.body.querySelector('input[aria-label="✨ Sparkly glow"]') as HTMLInputElement | null;
    expect(toggle).toBeTruthy();
    act(() => toggle!.click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastPostBody()).toEqual({ patch: { glow: true } });
  });

  it("sign-out is two-tap: first tap arms the confirm (no logout), second calls logout exactly once", () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    act(() => buttonByText("🚪 Sign out").click());
    expect(logoutMock).not.toHaveBeenCalled();
    const confirm = buttonByText("Sign me out");
    expect(confirm).toBeTruthy();
    act(() => confirm.click());
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("the rendered tree contains NO input with placeholder/type containing 'pin' (case-insensitive)", () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    const inputs = Array.from(document.body.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const placeholder = (input.getAttribute("placeholder") || "").toLowerCase();
      const type = (input.getAttribute("type") || "").toLowerCase();
      expect(placeholder.includes("pin")).toBe(false);
      expect(type.includes("pin")).toBe(false);
    }
  });

  it("a pet session still attempts the save on emoji tap and the 401 copy renders (server is the gate)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Avatar fields only on a child session" }),
    });
    const petMember = { ...member, emoji: "🐶", role: "pet" } as typeof member & { role: string };
    render(<KidProfileSheet open onClose={vi.fn()} member={petMember} />);
    act(() => emojiCell("🥳").click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dialog().textContent).toContain("Parents change this in Settings.");
  });

  it("a successful save shows the calm 'Saved!' confirmation", async () => {
    render(<KidProfileSheet open onClose={vi.fn()} member={member} />);
    act(() => emojiCell("🥳").click());
    await act(async () => {});
    expect(dialog().textContent).toContain("Saved!");
  });
});
