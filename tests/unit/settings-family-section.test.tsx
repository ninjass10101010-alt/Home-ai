// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const members: any[] = [];
  return {
    members,
    selectMembersDetailed: vi.fn(() => members),
    refreshMembersCache: vi.fn(async (): Promise<boolean> => true),
  };
});

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: mocks.selectMembersDetailed,
    refreshMembersCache: mocks.refreshMembersCache,
  },
}));

vi.mock("@/components/settings/WeeklyPrizesCard", () => ({ default: () => null }));

import FamilySettingsSection from "@/components/settings/FamilySettingsSection";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface FetchCall {
  url: string;
  method?: string;
  body?: Record<string, any>;
}

type FetchResponder = (call: FetchCall) => Promise<unknown>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const roots: Root[] = [];
let calls: FetchCall[] = [];

function response(ok: boolean, status: number, data: Record<string, unknown> = {}) {
  return { ok, status, json: async () => data };
}

function stubFetch(responder?: FetchResponder) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (responder) return responder(call);
    return response(true, call.method === "POST" ? 201 : 200, call.method === "POST" ? { starterPin: "1234" } : {});
  }));
}

async function mount(ui: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
  return host;
}

async function unmountLast() {
  const root = roots.pop();
  if (!root) return;
  await act(async () => root.unmount());
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function dialog(): HTMLElement {
  const value = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!value) throw new Error("Dialog not found");
  return value;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openEditor(ariaLabel = "Edit member") {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (!button) throw new Error(`Button not found: ${ariaLabel}`);
  await act(async () => button.click());
  await settle();
}

function baseMember(overrides: Record<string, unknown> = {}) {
  return {
    pbId: "pb_default",
    name: "Aurora",
    role: "child",
    age: 7,
    joined: "Mar 2024",
    emoji: "👧",
    color: "violet",
    avatarSize: "md",
    glow: false,
    pin: "9999",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.members.splice(0);
  mocks.selectMembersDetailed.mockReset();
  mocks.selectMembersDetailed.mockImplementation(() => mocks.members);
  mocks.refreshMembersCache.mockReset();
  mocks.refreshMembersCache.mockResolvedValue(true);
  stubFetch();
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FamilySettingsSection", () => {
  it("re-reads once on mount so a stale fallback cannot survive the subscription gap", async () => {
    const stale = baseMember({ name: "Stale Fallback" });
    const fresh = baseMember({ name: "Fresh Mount" });
    let reads = 0;
    mocks.selectMembersDetailed.mockImplementation(() => {
      reads += 1;
      return reads === 1 ? [stale] : [fresh];
    });

    const host = await mount(<FamilySettingsSection />);
    await settle();

    expect(host.textContent).toContain("Fresh Mount");
    expect(host.textContent).not.toContain("Stale Fallback");
  });

  it("re-reads and sanitizes the roster on member update events, then unsubscribes", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    mocks.members.push(baseMember({ name: "Stale Child", emoji: "🧓" }));
    const host = await mount(<FamilySettingsSection />);
    expect(host.textContent).toContain("Stale Child");

    mocks.members.splice(
      0,
      mocks.members.length,
      baseMember({ name: "Fresh Child", emoji: "data:image/webp;base64,AAAA", color: "cyan" }),
    );
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });

    expect(host.textContent).toContain("Fresh Child");
    expect(host.textContent).not.toContain("Stale Child");
    const memberHandler = addEventListener.mock.calls.find(([event]) => event === "consuela-members-updated")?.[1];
    expect(memberHandler).toBeTypeOf("function");

    await unmountLast();
    expect(removeEventListener).toHaveBeenCalledWith("consuela-members-updated", memberHandler);
  });

  it("keeps add open and reports a failed shared-roster refresh", async () => {
    mocks.refreshMembersCache.mockResolvedValue(false);
    const host = await mount(<FamilySettingsSection />);
    await act(async () => buttonByText(host, "Add member").click());
    await settle();

    const modal = dialog();
    await act(async () => setInputValue(modal.querySelector<HTMLInputElement>('input[placeholder="Member name"]')!, "Rowan"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("shared family roster could not refresh");
    expect(host.textContent).not.toContain("Added Rowan");
  });

  it("keeps edit open and reports a failed shared-roster refresh", async () => {
    mocks.members.push(baseMember());
    mocks.refreshMembersCache.mockResolvedValue(false);
    const host = await mount(<FamilySettingsSection />);
    await openEditor();

    const modal = dialog();
    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("shared family roster could not refresh");
    expect(host.textContent).not.toContain("Updated Aurora");
  });

  it("blocks Escape, backdrop, Cancel, and form mutations while a save is pending", async () => {
    const request = deferred<unknown>();
    stubFetch(async () => request.promise);
    mocks.members.push(baseMember());
    await mount(<FamilySettingsSection />);
    await openEditor();

    let modal = dialog();
    await act(async () => buttonByText(modal, "Save").click());

    modal = dialog();
    expect(buttonByText(modal, "Cancel").disabled).toBe(true);
    expect(modal.querySelector("fieldset[disabled]")).not.toBeNull();
    expect(modal.querySelector<HTMLInputElement>('input[placeholder="Member name"]')!.matches(":disabled")).toBe(true);
    expect(modal.querySelector<HTMLButtonElement>('button[aria-label^="Choose "]')!.matches(":disabled")).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      modal.parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttonByText(modal, "Cancel").click();
      buttonByText(modal, "Save").click();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(calls).toHaveLength(1);

    await act(async () => request.resolve(response(true, 200)));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("wires stable invalid-field descriptions and focuses the first invalid control", async () => {
    mocks.members.push(baseMember());
    const host = await mount(<FamilySettingsSection />);
    await act(async () => buttonByText(host, "Add member").click());
    await settle();

    let modal = dialog();
    let nameInput = modal.querySelector<HTMLInputElement>('input[placeholder="Member name"]')!;
    expect(document.querySelector('label[for="settings-family-member-name"]')).not.toBeNull();
    await act(async () => buttonByText(modal, "Save").click());
    await settle();
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-describedby")).toBe("settings-family-member-name-error");
    expect(document.getElementById("settings-family-member-name-error")).not.toBeNull();
    expect(document.activeElement).toBe(nameInput);

    await act(async () => setInputValue(nameInput, "Rowan"));
    const ageInput = modal.querySelector<HTMLInputElement>('input[aria-label="Age"]')!;
    await act(async () => setInputValue(ageInput, "150"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();
    expect(ageInput.getAttribute("aria-invalid")).toBe("true");
    expect(ageInput.getAttribute("aria-describedby")).toBe("settings-family-member-age-error");
    expect(document.activeElement).toBe(ageInput);

    await act(async () => setInputValue(ageInput, "8"));
    await act(async () => buttonByText(modal, "Cancel").click());
    await settle();
    await openEditor();
    modal = dialog();
    const pinInput = modal.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
    await act(async () => setInputValue(pinInput, "12"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();
    expect(pinInput.getAttribute("aria-invalid")).toBe("true");
    expect(pinInput.getAttribute("aria-describedby")).toBe("settings-family-member-pin-error");
    expect(document.activeElement).toBe(pinInput);
  });

  it("keeps the incumbent green list avatar color", async () => {
    mocks.members.push(baseMember({ color: "violet" }));
    const host = await mount(<FamilySettingsSection />);
    const row = Array.from(host.querySelectorAll(".group")).find((candidate) => candidate.textContent?.includes("Aurora"))!;
    const avatar = row.querySelector("div.rounded-full")!;
    expect(avatar.className).toContain("bg-[var(--color-accent-mint)]");
    expect(avatar.className).not.toContain("bg-[var(--color-accent-violet)]");
  });

  it("preserves legacy capitalized roles from the detailed roster", async () => {
    mocks.members.push(baseMember({ role: "Parent" }));
    const host = await mount(<FamilySettingsSection />);

    expect(host.textContent).toContain("Parent · Mar 2024");
  });

  it("adds a member without collecting or sending a PIN and explains server assignment", async () => {
    const host = await mount(<FamilySettingsSection />);
    await act(async () => buttonByText(host, "Add member").click());
    await settle();

    const modal = dialog();
    expect(modal.textContent).toContain("The server assigns their starter PIN after the member is added.");
    expect(modal.querySelector('input[type="password"]')).toBeNull();
    expect(modal.querySelector('input[autocomplete="one-time-code"]')).toBeNull();

    const nameInput = modal.querySelector<HTMLInputElement>('input[placeholder="Member name"]')!;
    await act(async () => setInputValue(nameInput, "Rowan"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/members/admin", method: "POST" });
    expect(calls[0].body).toMatchObject({ name: "Rowan", role: "child", emoji: "😊", avatarSize: "md", glow: false });
    expect(calls[0].body).not.toHaveProperty("pin");
    expect(mocks.refreshMembersCache).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Added Rowan");
  });

  it("shows the server starter PIN once after adding an arbitrary member", async () => {
    stubFetch(async (call) => response(
      true,
      call.method === "POST" ? 201 : 200,
      call.method === "POST" ? { starterPin: "4821", member: { id: "new-1", name: "Rowan" } } : {},
    ));
    const host = await mount(<FamilySettingsSection />);
    await act(async () => buttonByText(host, "Add member").click());
    await settle();

    const modal = dialog();
    const nameInput = modal.querySelector<HTMLInputElement>('input[placeholder="Member name"]')!;
    await act(async () => setInputValue(nameInput, "Rowan"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(dialog().textContent).toContain("Starter PIN");
    expect(dialog().textContent).toContain("4821");
    expect(dialog().querySelector('input[type="password"]')).toBeNull();

    await act(async () => buttonByText(dialog(), "Done").click());
    await settle();
    expect(host.textContent).not.toContain("4821");
  });

  it("preserves photo identity and member settings while omitting a blank edit PIN", async () => {
    const photo = "data:image/webp;base64,AAAA";
    mocks.members.push(baseMember({
      name: "Rebecca (Mom)",
      role: "parent",
      age: 38,
      emoji: photo,
      color: "green",
      avatarSize: "lg",
      glow: true,
    }));
    stubFetch();
    const host = await mount(<FamilySettingsSection />);
    await openEditor();

    const modal = dialog();
    const pinInput = modal.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
    expect(pinInput.value).toBe("");
    expect(modal.textContent).toContain("Leave blank to keep the current PIN.");
    expect(modal.querySelector<HTMLImageElement>(`img[src="${photo}"]`)).not.toBeNull();

    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(calls[0]).toMatchObject({ url: "/api/members/admin", method: "PATCH" });
    expect(calls[0].body).toMatchObject({
      name: "Rebecca (Mom)",
      patch: {
        name: "Rebecca (Mom)",
        emoji: photo,
        role: "parent",
        age: 38,
        avatarSize: "lg",
        glow: true,
      },
    });
    expect(calls[0].body!.patch).not.toHaveProperty("pin");
    expect(mocks.refreshMembersCache).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Updated Rebecca (Mom)");
  });

  it("validates a replacement PIN before sending the edit", async () => {
    mocks.members.push(baseMember());
    stubFetch();
    const host = await mount(<FamilySettingsSection />);
    await openEditor();

    let modal = dialog();
    const pinInput = modal.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
    await act(async () => setInputValue(pinInput, "12"));
    await act(async () => buttonByText(modal, "Save").click());
    await settle();

    expect(modal.textContent).toContain("PIN must be exactly 4 digits — or leave it blank to keep the current PIN.");
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain("People, pets, and roles");
  });

  it("preserves an emoji selection in the member PATCH", async () => {
    mocks.members.push(baseMember());
    stubFetch();
    await mount(<FamilySettingsSection />);
    await openEditor();

    const modal = dialog();
    const emojiButton = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.getAttribute("aria-label")?.startsWith("Choose "),
    )!;
    const emoji = emojiButton.getAttribute("aria-label")!.replace("Choose ", "");
    await act(async () => emojiButton.click());
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();

    expect(calls[0].body!.patch).toMatchObject({ emoji });
    expect(calls[0].body!.patch).not.toHaveProperty("pin");
  });

  it("requires confirmation before deleting and refreshes the roster after success", async () => {
    mocks.members.push(baseMember());
    stubFetch();
    const host = await mount(<FamilySettingsSection />);
    await openEditor("Remove Aurora");

    let modal = dialog();
    expect(modal.textContent).toContain("Aurora will disappear from avatars, tasks, and the family row on every device.");
    expect(calls).toHaveLength(0);
    await act(async () => buttonByText(modal, "Cancel").click());
    await settle();
    expect(calls).toHaveLength(0);

    await openEditor("Remove Aurora");
    modal = dialog();
    await act(async () => buttonByText(modal, "Remove member").click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/members/admin", method: "DELETE", body: { name: "Aurora" } });
    expect(mocks.refreshMembersCache).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Removed Aurora");
    expect(host.querySelector('[role="status"]')?.className).toContain("bg-[var(--color-accent-mint)]");
  });

  it("removes a known deleted row locally and warns when the shared roster cannot refresh", async () => {
    mocks.members.push(baseMember());
    mocks.refreshMembersCache.mockResolvedValue(false);
    const host = await mount(<FamilySettingsSection />);
    await openEditor("Remove Aurora");

    const modal = dialog();
    await act(async () => buttonByText(modal, "Remove member").click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain("child · Mar 2024");
    expect(host.textContent).toContain("Removed Aurora locally, but the shared family roster could not refresh.");
    expect(host.textContent).not.toContain("🗑️ Removed Aurora");
    expect(host.querySelector('[role="status"]')?.className).toContain("bg-[var(--color-accent-rose)]");
  });

  it("surfaces the last-parent delete error without refreshing", async () => {
    mocks.members.push(baseMember({ name: "Rebecca (Mom)", role: "parent" }));
    stubFetch(async () => response(false, 400, { error: "last_parent" }));
    const host = await mount(<FamilySettingsSection />);
    await openEditor("Remove Rebecca (Mom)");

    const modal = dialog();
    await act(async () => buttonByText(modal, "Remove member").click());
    await settle();

    expect(mocks.refreshMembersCache).not.toHaveBeenCalled();
    expect(host.textContent).toContain("At least one parent must remain.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("targets live PB IDs and keeps fallback-only rows read-only", async () => {
    mocks.members.push(baseMember({ pbId: "pb_aurora" }));
    const host = await mount(<FamilySettingsSection />);
    await openEditor();
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();

    expect(calls[0].body).toMatchObject({ id: "pb_aurora", name: "Aurora" });

    mocks.members.splice(0, mocks.members.length, baseMember({ name: "Fallback Only", pbId: undefined }));
    const fallbackHost = await mount(<FamilySettingsSection />);
    const edit = fallbackHost.querySelector<HTMLButtonElement>('button[aria-label="Edit member"]');
    const remove = fallbackHost.querySelector<HTMLButtonElement>('button[aria-label^="Remove "]');
    expect(edit?.disabled).toBe(true);
    expect(remove?.disabled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("invites through the native share sheet with the current origin", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    const host = await mount(<FamilySettingsSection />);

    await act(async () => buttonByText(host, "Invite").click());
    await settle();

    expect(share).toHaveBeenCalledWith({
      title: "Consuela — AI Family Organizer",
      text: "Join our family on Consuela! Manage calendars, meals, chores, and more.",
      url: window.location.origin,
    });
  });
});
