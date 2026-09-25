// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: {
    hydrated: true,
    currentUser: { role: "parent" as "parent" | "child" | "pet" },
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState.value }));

vi.mock("@/components/settings/SettingsLauncher", () => ({
  default: ({ sections }: { sections: Array<{ id: string; title: string }> }) => (
    <nav data-testid="settings-launcher">
      {sections.map((section) => <span key={section.id}>{section.title}</span>)}
    </nav>
  ),
}));

vi.mock("@/components/ui/PageShell", () => ({
  default: ({ children }: { children: ReactElement }) => <main>{children}</main>,
}));

vi.mock("@/components/patterns/PageHeader", () => ({
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</header>
  ),
}));

import SettingsPage from "@/app/settings/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<SettingsPage />));
  return container;
}

describe("settings launcher page wiring", () => {
  beforeEach(() => {
    authState.value = {
      hydrated: true,
      currentUser: { role: "parent" },
    };
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    container = null;
    document.body.innerHTML = "";
  });

  it("mounts only the six approved parent categories", async () => {
    const element = await renderPage();
    const launcher = element.querySelector('[data-testid="settings-launcher"]');

    expect(launcher).not.toBeNull();
    expect(launcher?.querySelectorAll("span")).toHaveLength(6);
    expect(element.textContent).not.toContain("Export JSON");
  });

  it("mounts only Me, Safety, and Appearance for a child", async () => {
    authState.value = {
      hydrated: true,
      currentUser: { role: "child" },
    };

    const element = await renderPage();
    const launcher = element.querySelector('[data-testid="settings-launcher"]');

    expect(launcher?.querySelectorAll("span")).toHaveLength(3);
    expect(launcher?.textContent).toContain("Me");
    expect(launcher?.textContent).toContain("Safety");
    expect(launcher?.textContent).toContain("Appearance");
    expect(launcher?.textContent).not.toContain("Family");
    expect(launcher?.textContent).not.toContain("Connections & System");
  });
});
