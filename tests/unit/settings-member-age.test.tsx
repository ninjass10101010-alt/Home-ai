// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import SettingsPage from "@/app/settings/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

// STABLE object identity: the page destructures useAuth() and consumers may
// key effects on it — a fresh object per render risks a subscribe loop.
const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Rebecca (Mom)", role: "parent" },
  isLoggedIn: true,
  logout: () => {},
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      mode: "dark",
      accentColor: "violet",
      contrastBoost: false,
      accentHex: {
        selected: "#7c6ff7",
        glow: "rgba(124,111,247,0.28)",
        button: "#7c6ff7",
        border: "rgba(124,111,247,0.35)",
      },
    },
    setMode: () => {},
    setAccentColor: () => {},
    setContrastBoost: () => {},
    setAccentHex: () => {},
  }),
}));

// STABLE identities matter: the page's mount effect depends on
// setSuppressRehydrate — a fresh function per render would re-fire it forever.
vi.mock("@/hooks/useHomeLayout", () => {
  const setSuppressRehydrate = () => {};
  const noop = () => {};
  return {
    useHomeLayout: () => ({
      config: {
        phone: { widgets: [], hidden: [] },
        tablet: { widgets: [], hidden: [] },
        desktop: { widgets: [], hidden: [] },
      },
      orientation: "phone",
      visibleWidgetsFor: () => [],
      orderedWidgetsFor: () => [],
      moveUpFor: noop,
      moveDownFor: noop,
      reorderFor: noop,
      toggleFor: noop,
      resetLayout: noop,
      setSuppressRehydrate,
    }),
  };
});

vi.mock("@/hooks/useFogConfig", () => ({
  useFogConfig: () => ({
    config: { enabled: false, speed: 1, blurFactor: 0.5, highlightColor: "#ffffff", lowlightColor: "#000000" },
    setEnabled: () => {},
    setSpeed: () => {},
    setBlurFactor: () => {},
    setHighlightColor: () => {},
    setLowlightColor: () => {},
    resetConfig: () => {},
  }),
}));

// Roster: Aurora (child, age 7) is the age-carrying member the modal edits.
vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [
      { id: 6, name: "Aurora", fullName: "Aurora Garcia", role: "child", age: 7, emoji: "👧", color: "violet", joined: "Mar 2024", avatarSize: "md", glow: false },
    ],
    selectEmergencyContacts: () => [],
    refreshMembersCache: vi.fn(async () => {}),
  },
}));

// The fetch-hungry integration cards keep their own suites — null them so this
// file tests the member modal, not four unrelated mount-time round trips.
vi.mock("@/components/settings/GoogleConnectCard", () => ({ default: () => null }));
vi.mock("@/components/settings/HaNotificationsCard", () => ({ default: () => null }));
vi.mock("@/components/settings/ServicesKeysCard", () => ({ default: () => null }));
vi.mock("@/components/settings/AiModelsCard", () => ({ default: () => null }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

function stubFetch() {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      calls.push({ url: u, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    })
  );
  return calls;
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(ui);
  });
  return el;
}

async function settle(ms = 50) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dialog(): HTMLElement {
  // The shared Modal portals to document.body.
  const d = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(d).not.toBeNull();
  return d!;
}

function buttonIn(scope: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll("button")).find((b) => (b.textContent || "").includes(text));
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn as HTMLButtonElement;
}

async function openAuroraEditor() {
  const edit = Array.from(document.querySelectorAll('button[aria-label="Edit member"]'))[0];
  expect(edit).toBeTruthy();
  await act(async () => {
    (edit as HTMLElement).click();
  });
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});

describe("Settings member age control", () => {
  it("edit modal carries the member's age and PATCHes the new number", async () => {
    const calls = stubFetch();
    await renderAsync(<SettingsPage />);
    await settle();

    await openAuroraEditor();

    const ageInput = dialog().querySelector('input[aria-label="Age"]') as HTMLInputElement | null;
    expect(ageInput).not.toBeNull();
    expect(ageInput!.value).toBe("7");
    expect(dialog().textContent).toContain("Under 10 signs in with one tap");

    await act(async () => { setInputValue(ageInput!, "9"); });
    await act(async () => { buttonIn(dialog(), "Save").click(); });
    await settle();

    const patch = calls.find((c) => c.url.includes("/api/members/admin") && c.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch!.body.name).toBe("Aurora");
    expect(patch!.body.patch.age).toBe(9);
  });

  it("blanking the age omits it from the PATCH (blank = leave unchanged, like the PIN field)", async () => {
    const calls = stubFetch();
    await renderAsync(<SettingsPage />);
    await settle();

    await openAuroraEditor();
    const ageInput = dialog().querySelector('input[aria-label="Age"]') as HTMLInputElement;
    expect(ageInput.value).toBe("7");

    await act(async () => { setInputValue(ageInput, ""); });
    await act(async () => { buttonIn(dialog(), "Save").click(); });
    await settle();

    const patch = calls.find((c) => c.url.includes("/api/members/admin") && c.method === "PATCH");
    expect(patch).toBeTruthy();
    expect("age" in patch!.body.patch).toBe(false);
  });

  it("out-of-range age blocks the save with the inline error", async () => {
    const calls = stubFetch();
    await renderAsync(<SettingsPage />);
    await settle();

    await openAuroraEditor();
    const ageInput = dialog().querySelector('input[aria-label="Age"]') as HTMLInputElement;
    await act(async () => { setInputValue(ageInput, "150"); });
    await act(async () => { buttonIn(dialog(), "Save").click(); });
    await settle();

    expect(dialog().textContent).toContain("Age must be 1–120 (or blank).");
    expect(calls.some((c) => c.url.includes("/api/members/admin"))).toBe(false);
  });
});
