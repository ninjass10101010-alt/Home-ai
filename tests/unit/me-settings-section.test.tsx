// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestUser {
  id: number;
  name: string;
  role: "parent" | "child" | "pet";
  emoji: string;
  color: string;
  avatarSize: string;
  glow: boolean;
  age?: number;
}

const authState = vi.hoisted(() => ({
  hydrated: true,
  currentUser: null as null | {
    id: number;
    name: string;
    role: "parent" | "child" | "pet";
    emoji: string;
    color: string;
    avatarSize: string;
    glow: boolean;
    age?: number;
  },
  login: vi.fn<(memberName: string, pin: string) => Promise<{ success: boolean; error?: string }>>(),
}));

const dbState = vi.hoisted(() => ({
  selectMembersDetailed: vi.fn(() => [] as Array<Record<string, unknown>>),
}));

const sheetCalls = vi.hoisted(() => ({
  parent: [] as Array<{
    open: boolean;
    member: Record<string, unknown>;
    panelClassName?: string;
  }>,
  kid: [] as Array<{
    open: boolean;
    member: Record<string, unknown>;
    panelClassName?: string;
  }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/db", () => ({
  db: dbState,
}));

vi.mock("@/components/profile/ProfileSheet", () => ({
  default: (props: {
    open: boolean;
    member: Record<string, unknown>;
    panelClassName?: string;
  }) => {
    sheetCalls.parent.push(props);
    return props.open ? <div data-testid="parent-profile-sheet" /> : null;
  },
}));

vi.mock("@/components/modes/kid/KidProfileSheet", () => ({
  default: (props: {
    open: boolean;
    member: Record<string, unknown>;
    panelClassName?: string;
  }) => {
    sheetCalls.kid.push(props);
    return props.open ? <div data-testid="kid-profile-sheet" /> : null;
  },
}));

import MeSettingsSection from "@/components/settings/MeSettingsSection";
import SettingsSignInDialog from "@/components/settings/SettingsSignInDialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

let root: Root | null = null;
let element: HTMLElement | null = null;

function renderView() {
  if (!root) {
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
  }
  act(() => root!.render(<MeSettingsSection />));
  return element!;
}

function user(role: TestUser["role"], name: string, age?: number): TestUser {
  return {
    id: role === "parent" ? 1 : role === "child" ? 2 : 3,
    name,
    role,
    emoji: role === "parent" ? "🧑" : role === "child" ? "🧒" : "🐶",
    color: role === "parent" ? "green" : role === "child" ? "violet" : "amber",
    avatarSize: "lg",
    glow: true,
    age,
  };
}

function roster() {
  return [
    {
      name: "Alex Rivera",
      role: "Parent",
      age: 42,
      emoji: "🧑",
      color: "green",
      avatarSize: "lg",
      glow: true,
      pin: "1234",
    },
    {
      name: "Bailey Rivera",
      role: "Child",
      age: 8,
      emoji: "https://example.com/not-an-emoji.png",
      color: "chartreuse",
      avatarSize: "base",
      glow: 0,
      pin: "5678",
      image: "https://example.com/photo.png",
      dataUrl: "data:image/png;base64,excluded",
      arbitrary: "excluded",
    },
  ];
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(elementToClick: Element | null | undefined) {
  await act(async () => {
    (elementToClick as HTMLElement | null)?.click();
  });
}

function openGuestPicker() {
  const signIn = element!.querySelector<HTMLButtonElement>('button[aria-label="Sign in"]');
  act(() => signIn?.click());
  return Array.from(dialog()?.querySelectorAll("button") ?? []).find((button) =>
    button.textContent?.includes("Bailey"),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const extraRoots: Root[] = [];

function renderSignInDialog(ui: React.ReactElement) {
  const dialogElement = document.createElement("div");
  document.body.appendChild(dialogElement);
  const dialogRoot = createRoot(dialogElement);
  extraRoots.push(dialogRoot);
  act(() => dialogRoot.render(ui));
  return dialogRoot;
}

describe("MeSettingsSection", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    authState.hydrated = true;
    authState.currentUser = null;
    authState.login.mockReset();
    authState.login.mockResolvedValue({ success: false, error: "Incorrect PIN" });
    dbState.selectMembersDetailed.mockReset();
    dbState.selectMembersDetailed.mockReturnValue(roster());
    sheetCalls.parent.length = 0;
    sheetCalls.kid.length = 0;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    while (extraRoots.length > 0) {
      act(() => extraRoots.pop()!.unmount());
    }
    if (root) {
      act(() => root!.unmount());
    }
    root = null;
    element = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("waits for auth hydration before showing any signed-in or guest branch", () => {
    authState.hydrated = false;
    authState.currentUser = user("parent", "Alex Rivera", 42);

    const view = renderView();

    expect(view.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(view.querySelector('button[aria-label="Edit profile"]')).toBeNull();
    expect(view.querySelector('button[aria-label="Sign in"]')).toBeNull();
    expect(sheetCalls.parent).toHaveLength(0);
    expect(sheetCalls.kid).toHaveLength(0);

    authState.hydrated = true;
    act(() => root!.render(<MeSettingsSection />));

    expect(view.querySelector('[aria-busy="true"]')).toBeNull();
    expect(view.querySelector('button[aria-label="Edit profile"]')).toBeTruthy();
  });

  it("shows only the parent profile summary and opens ProfileSheet with the settings panel seam", () => {
    const currentUser = user("parent", "Alex Rivera", 42);
    authState.currentUser = currentUser;

    const view = renderView();
    const edit = view.querySelector<HTMLButtonElement>('button[aria-label="Edit profile"]');

    expect(view.textContent).toContain("Alex Rivera");
    expect(view.textContent).not.toMatch(/\bparent\b/i);
    expect(view.textContent).not.toContain("42");
    expect(view.textContent).not.toContain("Bailey");
    expect(edit).toBeTruthy();
    edit!.focus();
    expect(document.activeElement).toBe(edit);
    act(() => edit!.click());

    expect(sheetCalls.kid).toHaveLength(0);
    const call = sheetCalls.parent.at(-1)!;
    expect(call.open).toBe(true);
    expect(call.member).toEqual(currentUser);
    expect(call.panelClassName).toBe("settings-dialog");
  });

  it.each(["child", "pet"] as const)("shows only the %s profile summary and opens KidProfileSheet without role or age", (role) => {
    const currentUser = user(role, role === "child" ? "Bailey Rivera" : "Rocco", 8);
    authState.currentUser = currentUser;

    const view = renderView();
    const edit = view.querySelector<HTMLButtonElement>('button[aria-label="Edit profile"]');

    expect(view.textContent).toContain(currentUser.name);
    expect(view.textContent).not.toMatch(new RegExp(`\\b${role}\\b`, "i"));
    expect(view.textContent).not.toContain("8");
    expect(view.textContent).not.toContain("Alex");
    expect(edit).toBeTruthy();
    act(() => edit!.click());

    expect(sheetCalls.parent).toHaveLength(0);
    const call = sheetCalls.kid.at(-1)!;
    expect(call.open).toBe(true);
    expect(call.member).toEqual({
      name: currentUser.name,
      color: currentUser.color,
      emoji: currentUser.emoji,
      avatarSize: currentUser.avatarSize,
      glow: currentUser.glow,
    });
    expect(call.member).not.toHaveProperty("role");
    expect(call.member).not.toHaveProperty("age");
    expect(call.panelClassName).toBe("settings-dialog");
  });

  it("uses the real roster selection and verifies the selected guest PIN only through useAuth.login", async () => {
    const view = renderView();

    expect(view.textContent).not.toContain("Alex Rivera");
    expect(view.textContent).not.toContain("Bailey Rivera");
    expect(view.textContent).not.toMatch(/\bparent\b/i);
    expect(view.textContent).not.toMatch(/\bchild\b/i);
    expect(view.textContent).not.toContain("42");
    expect(view.textContent).not.toContain("5678");

    const bailey = openGuestPicker();
    expect(bailey).toBeTruthy();
    expect(dialog()?.className).toContain("settings-dialog");
    expect(dialog()?.textContent).toContain("Pick your face, then enter your 4-digit PIN.");
    expect(dialog()?.textContent).not.toContain("little kids sign right in");
    expect(dialog()?.textContent).toContain("Bailey");
    expect(dialog()?.textContent).not.toContain("Parent");
    expect(dialog()?.textContent).not.toContain("Child");
    expect(dialog()?.textContent).not.toContain("42");
    expect(dialog()?.textContent).not.toContain("8");
    expect(dialog()?.textContent).not.toContain("https://example.com");
    expect(dialog()?.textContent).not.toContain("data:image/png");
    expect(dialog()?.textContent).not.toContain("chartreuse");
    expect(dialog()?.querySelector("img")).toBeNull();

    await click(bailey);

    expect(document.body.textContent).toContain("Sign in as Bailey");
    expect(document.body.textContent).not.toContain("Who's signing in?");
    expect(dialog()?.className).toContain("settings-dialog");

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).toBeTruthy();
    expect(input!.type).toBe("password");
    expect(input!.inputMode).toBe("numeric");
    expect(input!.maxLength).toBe(4);
    expect(input!.hasAttribute("name")).toBe(false);
    expect(input!.labels?.[0]?.textContent).toContain("4-digit PIN");
    expect(document.activeElement).toBe(input);

    setInputValue(input!, "12a34567");
    expect(input!.value).toBe("1234");

    authState.login.mockResolvedValueOnce({ success: true });
    await click(dialog()?.querySelector('button[type="submit"]'));

    expect(authState.login).toHaveBeenCalledTimes(1);
    expect(authState.login).toHaveBeenCalledWith("Bailey Rivera", "1234");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the memory-only PIN after a failed retry and when the dialog closes", async () => {
    const view = renderView();
    await click(openGuestPicker());

    let input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]');
    setInputValue(input!, "1234");
    await click(dialog()?.querySelector('button[type="submit"]'));

    expect(authState.login).toHaveBeenCalledWith("Bailey Rivera", "1234");
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("Incorrect PIN");
    input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input!.value).toBe("");
    expect(document.activeElement).toBe(input);

    setInputValue(input!, "2468");
    expect(input!.value).toBe("2468");
    await click(dialog()?.querySelector('button[aria-label="Cancel sign in"]'));

    const signIn = view.querySelector('button[aria-label="Sign in"]');
    expect(signIn).toBeTruthy();
    expect(document.activeElement).toBe(signIn);
    await click(openGuestPicker());
    input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input!.value).toBe("");
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps busy sign-in focusable and blocks dismissal until completion", async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    authState.login.mockReturnValueOnce(pending.promise);
    const dialogRoot = renderSignInDialog(
      <SettingsSignInDialog
        open
        memberName="Bailey Rivera"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(dialog()?.textContent).toContain(
      "Your PIN is used only to sign in and is cleared from this form after a failed attempt.",
    );
    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    input.focus();
    act(() => dialog()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());

    const busyInput = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    const cancel = dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Cancel sign in"]')!;
    expect(dialog()?.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(busyInput.readOnly).toBe(true);
    expect(busyInput.getAttribute("aria-readonly")).toBe("true");
    expect(busyInput.disabled).toBe(false);
    expect(cancel.disabled).toBe(true);
    expect(dialog()?.contains(document.activeElement)).toBe(true);

    await click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ success: true });
      await pending.promise;
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    act(() => {
      dialogRoot.render(
        <SettingsSignInDialog
          open={false}
          memberName="Bailey Rivera"
          onClose={onClose}
          onSuccess={onSuccess}
        />,
      );
    });

    expect(dialog()).toBeNull();
  });

  it("uses a generic retry fallback when login omits an error", async () => {
    authState.login.mockResolvedValueOnce({ success: false });
    renderSignInDialog(
      <SettingsSignInDialog
        open
        memberName="Bailey Rivera"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    await click(dialog()?.querySelector('button[type="submit"]'));

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("Sign-in failed. Try again.");
    expect(input.value).toBe("");
    expect(input.readOnly).toBe(false);
    expect(input.getAttribute("aria-readonly")).toBe("false");
  });

  it("recovers honestly when the login promise rejects", async () => {
    authState.login.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderSignInDialog(
      <SettingsSignInDialog
        open
        memberName="Bailey Rivera"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    await click(dialog()?.querySelector('button[type="submit"]'));

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't reach Consuela — check the connection and try again.",
    );
    expect(input.value).toBe("");
    expect(input.readOnly).toBe(false);
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("closes on deferred success and reopens with an empty PIN", async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    authState.login.mockReturnValueOnce(pending.promise);
    renderView();
    await click(openGuestPicker());

    let input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    act(() => dialog()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    expect(dialog()?.textContent).toContain("Sign in as Bailey");

    await act(async () => {
      pending.resolve({ success: true });
      await pending.promise;
    });

    expect(dialog()).toBeNull();
    const bailey = openGuestPicker();
    expect(bailey).toBeTruthy();
    await click(bailey);
    input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(input.value).toBe("");
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps request tracking live after StrictMode effect replay", async () => {
    const onSuccess = vi.fn();
    authState.login.mockResolvedValueOnce({ success: true });
    renderSignInDialog(
      <StrictMode>
        <SettingsSignInDialog
          open
          memberName="Bailey Rivera"
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      </StrictMode>,
    );

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    await click(dialog()?.querySelector('button[type="submit"]'));

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("ignores a pending result after unmount without a state-update warning", async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    const onSuccess = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    authState.login.mockReturnValueOnce(pending.promise);
    const dialogRoot = renderSignInDialog(
      <SettingsSignInDialog
        open
        memberName="Bailey Rivera"
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="password"]')!;
    setInputValue(input, "1234");
    act(() => dialog()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    const rootIndex = extraRoots.indexOf(dialogRoot);
    if (rootIndex >= 0) extraRoots.splice(rootIndex, 1);
    act(() => dialogRoot.unmount());

    await act(async () => {
      pending.resolve({ success: true });
      await pending.promise;
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
