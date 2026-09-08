// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pathnameRef = { current: "/screensaver" };
vi.mock("next/navigation", () => ({ usePathname: () => pathnameRef.current }));
const refreshCaches = vi.fn(async () => {});
const flushPendingWrites = vi.fn(async () => {});
vi.mock("@/db", () => ({ db: { refreshCaches: () => refreshCaches() } }));
vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: () => flushPendingWrites() }));

import { CacheRefresher } from "@/components/ui/CacheRefresher";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

beforeEach(() => {
  refreshCaches.mockClear();
  flushPendingWrites.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("does not poll the gateway on /screensaver", async () => {
  pathnameRef.current = "/screensaver";
  const el = render(
    <CacheRefresher>
      <p>board</p>
    </CacheRefresher>
  );
  expect(el.textContent).toContain("board");
  await vi.waitFor(() => expect(refreshCaches).not.toHaveBeenCalled());
  expect(flushPendingWrites).not.toHaveBeenCalled();
});

it("still polls on normal routes", async () => {
  pathnameRef.current = "/";
  render(
    <CacheRefresher>
      <p>home</p>
    </CacheRefresher>
  );
  await vi.waitFor(() => expect(refreshCaches).toHaveBeenCalled());
});
