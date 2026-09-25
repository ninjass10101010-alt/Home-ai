// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hydrated: true,
  role: "parent" as "parent" | "child" | "pet" | null,
  contacts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ hydrated: state.hydrated, currentUser: state.role ? { role: state.role } : null }),
}));

vi.mock("@/db", () => ({
  db: { selectEmergencyContacts: () => [] },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/ui/TopBar", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/ui/Card", () => ({
  default: ({ children, interactive, ...props }: { children: ReactNode; interactive?: boolean; [key: string]: unknown }) => {
    void interactive;
    return <div {...props}>{children}</div>;
  },
}));

vi.mock("@/components/ui/Skeleton", () => ({
  default: () => <div>Loading</div>,
}));

import EmergencyPage from "@/app/emergency/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function renderPage() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<EmergencyPage />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

beforeEach(() => {
  state.hydrated = true;
  state.role = "parent";
  state.contacts = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ contacts: state.contacts, contactsSource: "live" }),
  })));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Emergency role-aware Safety copy", () => {
  it("keeps guidance neutral until auth hydration completes", async () => {
    state.hydrated = false;
    state.role = "parent";

    const element = await renderPage();
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href="/settings/safety"]'));

    expect(element.textContent).toContain("Ask a parent to add or manage emergency contacts.");
    expect(links.every((link) => link.textContent?.includes("Open safety settings"))).toBe(true);
    expect(element.textContent).not.toContain("Add contacts");
    expect(element.textContent).not.toContain("Manage contacts");
  });

  it("offers parents Add contacts when the roster is empty", async () => {
    const element = await renderPage();

    expect(element.textContent).toContain("Add or manage emergency contacts to get started.");
    const addLink = element.querySelector<HTMLAnchorElement>('a[href="/settings/safety"]');
    expect(addLink?.textContent).toBe("Add contacts");
    expect(element.textContent).not.toContain("Ask a parent");
  });

  it("offers parents Manage contacts when contacts already exist", async () => {
    state.contacts = [{
      id: 1,
      name: "Primary Person",
      phone: "+15551234567",
      email: "person@example.com",
      relationship: "parent",
      isPrimary: true,
    }];

    const element = await renderPage();
    const manageLink = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href="/settings/safety"]'))
      .find((link) => /manage contacts/i.test(link.textContent ?? ""));

    expect(manageLink).toBeTruthy();
    expect(element.textContent).toContain("Primary Person");
  });

  it.each(["child", "pet", null] as const)("gives %s sessions parent guidance and a neutral action", async (role) => {
    state.role = role;
    const element = await renderPage();
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href="/settings/safety"]'));

    expect(element.textContent).toContain("Ask a parent to add or manage emergency contacts.");
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.textContent?.includes("Open safety settings"))).toBe(true);
    expect(element.textContent).not.toContain("Add contacts");
    expect(element.textContent).not.toContain("Manage contacts");
  });
});
