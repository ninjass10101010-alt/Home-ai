// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contacts: [] as any[],
  auth: {
    hydrated: true,
    currentUser: null as null | { role: "parent" | "child" | "pet" },
  },
  selectEmergencyContacts: vi.fn(),
  insertEmergencyContact: vi.fn(),
  updateEmergencyContact: vi.fn(),
  deleteEmergencyContact: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    selectEmergencyContacts: mocks.selectEmergencyContacts,
    insertEmergencyContact: mocks.insertEmergencyContact,
    updateEmergencyContact: mocks.updateEmergencyContact,
    deleteEmergencyContact: mocks.deleteEmergencyContact,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/components/settings/EmergencyTestDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="test-alert-dialog">Test alert dialog</div> : null),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import SafetySettingsSection from "@/components/settings/SafetySettingsSection";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

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

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SafetySettingsSection />);
  });
  await settle();
  return host;
}

async function mountImmediate() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SafetySettingsSection />);
  });
  return host;
}

async function rerender() {
  await act(async () => {
    root!.render(<SafetySettingsSection />);
  });
  await settle();
}

async function rerenderImmediate() {
  await act(async () => {
    root!.render(<SafetySettingsSection />);
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dialog(): HTMLElement {
  const value = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!value) throw new Error("Dialog not found");
  return value;
}

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const value = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!value) throw new Error(`Button not found: ${text}`);
  return value;
}

function inputByPlaceholder(scope: HTMLElement, placeholder: string): HTMLInputElement {
  const value = scope.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!value) throw new Error(`Input not found: ${placeholder}`);
  return value;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function validContact(scope: HTMLElement) {
  setInputValue(inputByPlaceholder(scope, "Contact name"), "Primary Person");
  setInputValue(inputByPlaceholder(scope, "+15551234567"), "+15551234567");
  setInputValue(inputByPlaceholder(scope, "name@example.com"), "person@example.com");
}

async function openAdd() {
  await act(async () => buttonByText(host!, "Add contact").click());
  await settle();
}

function baseContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    name: "Primary Person",
    phone: "+15551234567",
    email: "person@example.com",
    relationship: "parent",
    isPrimary: true,
    emoji: "👩",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.contacts.splice(0, mocks.contacts.length, baseContact());
  mocks.auth.hydrated = true;
  mocks.auth.currentUser = { role: "parent" };
  mocks.selectEmergencyContacts.mockReset();
  mocks.selectEmergencyContacts.mockImplementation(() => [...mocks.contacts]);
  mocks.insertEmergencyContact.mockReset();
  mocks.updateEmergencyContact.mockReset();
  mocks.deleteEmergencyContact.mockReset();
  mocks.insertEmergencyContact.mockResolvedValue(null);
  mocks.updateEmergencyContact.mockResolvedValue(null);
  mocks.deleteEmergencyContact.mockResolvedValue(false);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SafetySettingsSection", () => {
  it("gives parents contact management, a real-alert test, and the reference link", async () => {
    const element = await mount();

    expect(element.textContent).toContain("Primary Person");
    expect(element.textContent).toContain("Add contact");
    expect(element.textContent).toContain("Test emergency alert");
    expect(element.textContent).toContain("Primary contacts receive serious alerts");
    const primaryBadge = element.querySelector<HTMLElement>('[data-testid="primary-contact-badge"]');
    expect(primaryBadge?.textContent).toBe("Primary");
    expect(primaryBadge?.classList.contains("text-[11px]")).toBe(true);
    expect(primaryBadge?.classList.contains("text-[10px]")).toBe(false);
    expect(element.querySelector('button[aria-label="Edit Primary Person"]')).toBeTruthy();
    expect(element.querySelector('a[href="/emergency"]')).toBeTruthy();
    expect(element.textContent).toContain("Emergency reference");
  });

  it.each(["child", "pet", null] as const)("shows only the emergency reference to %s sessions", async (role) => {
    mocks.auth.currentUser = role ? { role } : null;
    const element = await mount();

    expect(element.textContent).toContain("Emergency reference");
    expect(element.querySelector('a[href="/emergency"]')).toBeTruthy();
    expect(element.textContent).not.toContain("Add contact");
    expect(element.textContent).not.toContain("Test emergency alert");
    expect(element.textContent).not.toContain("Primary Person");
    expect(mocks.selectEmergencyContacts).not.toHaveBeenCalled();
  });

  it("shows an aria-busy contacts skeleton until the parent cache read commits", async () => {
    vi.useFakeTimers();
    const element = await mountImmediate();

    expect(element.querySelector('[data-safety-contacts-loading="true"]')).not.toBeNull();
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(element.textContent).not.toContain("No emergency contacts");
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(element.querySelector('[data-safety-contacts-loading="true"]')).toBeNull();
  });

  it("re-reads contacts after a delayed global cache refresh instead of keeping a false empty roster", async () => {
    let reads = 0;
    mocks.selectEmergencyContacts.mockImplementation(() => {
      reads += 1;
      return reads === 1 ? [] : [baseContact({ name: "Delayed Contact" })];
    });

    const element = await mount();
    expect(element.textContent).toContain("No emergency contacts");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(element.textContent).toContain("Delayed Contact");
    expect(element.textContent).not.toContain("No emergency contacts");
  });

  it("keeps the contact form open on validation failure and wires the first invalid field", async () => {
    mocks.contacts.splice(0, mocks.contacts.length);
    const element = await mount();
    await openAdd();

    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();

    const name = inputByPlaceholder(dialog(), "Contact name");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe("settings-safety-contact-name-error");
    expect(document.getElementById("settings-safety-contact-name-error")).not.toBeNull();
    expect(dialog().querySelector('[data-contact-error-summary="true"]')).not.toBeNull();
    expect(dialog().querySelector('[data-contact-error-summary="true"]')?.textContent).toContain("Fix the highlighted");
    expect(document.activeElement).toBe(name);

    await act(async () => setInputValue(name, "Primary Person"));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    const phone = inputByPlaceholder(dialog(), "+15551234567");
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    expect(phone.getAttribute("aria-describedby")).toBe("settings-safety-contact-phone-error");
    expect(document.activeElement).toBe(phone);

    await act(async () => setInputValue(phone, "+15551234567"));
    await act(async () => setInputValue(inputByPlaceholder(dialog(), "name@example.com"), "bad"));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    const email = inputByPlaceholder(dialog(), "name@example.com");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("settings-safety-contact-email-error");
    expect(document.activeElement).toBe(email);
    expect(element.textContent).not.toContain("Primary Person");
  });

  it("commits the error summary before moving focus to the first invalid control", async () => {
    mocks.contacts.splice(0, mocks.contacts.length);
    await mount();
    await openAdd();
    let sawSummaryAtFocus = false;
    const originalFocus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      if (dialog().querySelector('[data-contact-error-summary="true"]')) sawSummaryAtFocus = true;
      originalFocus.call(this);
    });
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    focusSpy.mockRestore();

    expect(sawSummaryAtFocus).toBe(true);
    expect(document.activeElement).toBe(inputByPlaceholder(dialog(), "Contact name"));
  });

  it("uses a real form so Enter submits the contact editor", async () => {
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    await mount();
    await openAdd();
    await act(async () => validContact(dialog()));

    const form = dialog().querySelector("form");
    const save = buttonByText(dialog(), "Save");
    expect(form).not.toBeNull();
    expect(save.getAttribute("type")).toBe("submit");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(mocks.insertEmergencyContact).toHaveBeenCalledTimes(1);
  });

  it("awaits insert and refreshes the visible cache only after a truthy result", async () => {
    const request = deferred<any>();
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const result = await request.promise;
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());

    expect(mocks.insertEmergencyContact).toHaveBeenCalledTimes(1);
    expect(mocks.selectEmergencyContacts).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("Primary Person");
    expect(buttonByText(dialog(), "Save").disabled).toBe(true);
    expect(inputByPlaceholder(dialog(), "Contact name").matches(":disabled")).toBe(true);

    await act(async () => {
      request.resolve({ id: "contact-2" });
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain("Added Primary Person");
    expect(element.textContent).toContain("Primary Person");
  });

  it("keeps the add form open and reports an honest error for a falsy insert", async () => {
    mocks.insertEmergencyContact.mockResolvedValue(null);
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog().textContent).toMatch(/couldn't add contact|could not add contact/i);
    expect(dialog().textContent).not.toMatch(/added primary person/i);
    expect(element.textContent).not.toContain("Added Primary Person");
  });

  it("awaits edit, preserves all contact fields, and does not close on a null update", async () => {
    const edit = deferred<any>();
    mocks.updateEmergencyContact.mockImplementation(async (id: string, updates: any) => {
      const result = await edit.promise;
      const row = mocks.contacts.find((contact) => contact.id === id);
      if (row) Object.assign(row, updates);
      return result;
    });
    const element = await mount();
    await act(async () => {
      const button = element.querySelector<HTMLButtonElement>('button[aria-label="Edit Primary Person"]');
      button?.click();
    });
    await settle();

    const phone = inputByPlaceholder(dialog(), "+15551234567");
    await act(async () => setInputValue(phone, "+15559999999"));
    await act(async () => buttonByText(dialog(), "Save").click());
    expect(mocks.updateEmergencyContact).toHaveBeenCalledWith("contact-1", expect.objectContaining({
      name: "Primary Person",
      phone: "+15559999999",
      email: "person@example.com",
      relationship: "parent",
      isPrimary: true,
      emoji: "👩",
    }));
    expect(element.textContent).toContain("Primary Person");

    await act(async () => {
      edit.resolve(null);
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog().textContent).toMatch(/couldn't update contact|could not update contact/i);
    expect(element.textContent).not.toContain("Updated Primary Person");
  });

  it("closes edit only after a truthy update and refreshes the visible cache", async () => {
    mocks.updateEmergencyContact.mockImplementation(async (id: string, updates: any) => {
      const row = mocks.contacts.find((contact) => contact.id === id);
      if (row) Object.assign(row, updates);
      return row;
    });
    const element = await mount();
    await act(async () => {
      element.querySelector<HTMLButtonElement>('button[aria-label="Edit Primary Person"]')?.click();
    });
    await settle();
    await act(async () => setInputValue(inputByPlaceholder(dialog(), "+15551234567"), "+15552222222"));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.selectEmergencyContacts).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain("+15552222222");
    expect(element.textContent).toContain("Updated Primary Person");
  });

  it("explains that a non-primary contact was not an alert recipient", async () => {
    mocks.contacts.splice(
      0,
      mocks.contacts.length,
      baseContact(),
      baseContact({ id: "contact-2", name: "Reference Person", isPrimary: false }),
    );
    const element = await mount();
    await act(async () => {
      element.querySelector<HTMLButtonElement>('button[aria-label="Remove Reference Person"]')?.click();
    });
    await settle();

    expect(dialog().textContent).toMatch(/was not an alert recipient/i);
  });

  it("confirms deletion, requires a true delete result, and blocks pending double submits", async () => {
    const request = deferred<boolean>();
    mocks.deleteEmergencyContact.mockImplementation(async (id: string) => {
      const result = await request.promise;
      if (result) {
        const index = mocks.contacts.findIndex((contact) => contact.id === id);
        if (index !== -1) mocks.contacts.splice(index, 1);
      }
      return result;
    });
    const element = await mount();
    await act(async () => {
      element.querySelector<HTMLButtonElement>('button[aria-label="Remove Primary Person"]')?.click();
    });
    await settle();

    const confirmation = dialog();
    expect(confirmation.textContent).toMatch(/primary contact will stop receiving serious alerts/i);
    expect(mocks.deleteEmergencyContact).not.toHaveBeenCalled();
    const remove = buttonByText(confirmation, "Remove contact");
    await act(async () => remove.click());
    expect(mocks.deleteEmergencyContact).toHaveBeenCalledTimes(1);
    expect(remove.disabled).toBe(true);
    await act(async () => remove.click());
    expect(mocks.deleteEmergencyContact).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve(false);
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog().textContent).toMatch(/couldn't remove contact|could not remove contact/i);

    mocks.deleteEmergencyContact.mockImplementation(async () => {
      const index = mocks.contacts.findIndex((contact) => contact.id === "contact-1");
      if (index !== -1) mocks.contacts.splice(index, 1);
      return true;
    });
    await act(async () => buttonByText(dialog(), "Retry").click());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain("No emergency contacts");
    expect(element.querySelector('button[aria-label="Edit Primary Person"]')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("settings-safety-add-contact"));
  });

  it("invalidates a pending save and its late feedback when the role changes to child", async () => {
    const request = deferred<any>();
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const result = await request.promise;
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());

    mocks.auth.currentUser = { role: "child" };
    await rerender();
    await act(async () => {
      request.resolve({ id: "contact-2" });
      await request.promise;
    });
    await settle();

    expect(element.textContent).not.toContain("Added Primary Person");
    expect(element.textContent).not.toContain("Primary Person");
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("invalidates a pending delete when the role changes to pet", async () => {
    const request = deferred<boolean>();
    mocks.deleteEmergencyContact.mockImplementation(async (id: string) => {
      const result = await request.promise;
      if (result) {
        const index = mocks.contacts.findIndex((contact) => contact.id === id);
        if (index !== -1) mocks.contacts.splice(index, 1);
      }
      return result;
    });
    const element = await mount();
    await act(async () => {
      element.querySelector<HTMLButtonElement>('button[aria-label="Remove Primary Person"]')?.click();
    });
    await settle();
    await act(async () => buttonByText(dialog(), "Remove contact").click());

    mocks.auth.currentUser = { role: "pet" };
    await rerender();
    await act(async () => {
      request.resolve(true);
      await request.promise;
    });
    await settle();

    expect(element.textContent).not.toContain("Removed Primary Person");
    expect(element.textContent).not.toContain("Primary Person");
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("clears feedback already queued when a parent session changes to guest", async () => {
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    expect(element.textContent).toContain("Added Primary Person");

    mocks.auth.currentUser = null;
    await rerender();
    expect(element.textContent).not.toContain("Added Primary Person");
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it("does not render parent feedback on the first non-parent commit", async () => {
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    expect(element.textContent).toContain("Added Primary Person");

    mocks.auth.currentUser = { role: "child" };
    await rerenderImmediate();

    expect(element.textContent).not.toContain("Added Primary Person");
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it("does not resurrect old feedback across a rapid parent-child-parent bounce", async () => {
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());
    await settle();
    expect(element.textContent).toContain("Added Primary Person");

    mocks.auth.currentUser = { role: "child" };
    await rerenderImmediate();
    mocks.auth.currentUser = { role: "parent" };
    await rerenderImmediate();
    await settle();

    expect(element.textContent).not.toContain("Added Primary Person");
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps a pending contact save open against close and reopen attempts", async () => {
    const request = deferred<any>();
    mocks.insertEmergencyContact.mockImplementation(async (data: any) => {
      const result = await request.promise;
      const row = { id: "contact-2", ...data };
      mocks.contacts.push(row);
      return row;
    });
    const element = await mount();
    await openAdd();
    await act(async () => validContact(dialog()));
    await act(async () => buttonByText(dialog(), "Save").click());

    await act(async () => {
      buttonByText(dialog(), "Cancel").click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog().parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttonByText(element, "Add contact").click();
    });
    expect(mocks.insertEmergencyContact).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      request.resolve({ id: "contact-2" });
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
