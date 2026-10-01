// @vitest-environment jsdom
// Task 7 — favorites (task templates) UI: the Add sheet's chip row, save-as-
// favorite, the manage sheet, and the one-time expiry control. Every durable
// write is observed on the REAL outbox (the page's one write seam), never a
// local store shortcut.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => routerMock,
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// A pet is on the roster so the prefill-skip rule is exercised for real.
const roster = vi.hoisted(() => [
  { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
  { id: 2, name: "Caspian", fullName: "Caspian Garcia", role: "child", age: 5, emoji: "🧒", color: "cyan" },
  { id: 3, name: "Emily", fullName: "Emily", role: "child", age: 14, emoji: "👧", color: "mint" },
  { id: 4, name: "Biscuit", fullName: "Biscuit", role: "pet", emoji: "🐶", color: "amber" },
]);
vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => true),
    selectMembers: () => roster,
    selectMembersFallback: () => [roster[0]],
  },
}));

import { __resetTaskOutboxForTests, listTaskOutbox } from "@/lib/task-operation-outbox";
import { __resetTaskCommandCredentialsForTests } from "@/lib/task-command-queue";
import { loadTaskTemplates, saveTaskTemplates } from "@/lib/task-utils";
import type { TaskTemplateConfigItem } from "@/lib/task-config";
import TasksPage from "@/app/tasks/page";

function seedWeek() {
  localStorage.setItem(
    "consuela-week-data",
    JSON.stringify({ weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [] })
  );
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function renderParent(): Promise<HTMLElement> {
  mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
  mockAuth.isLoggedIn = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<TasksPage />); });
  await settle();
  return el;
}

function dialogAt(index = 0): HTMLElement {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const found = dialogs[index] as HTMLElement | undefined;
  if (!found) throw new Error(`no dialog at ${index}`);
  return found;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === text
  );
  if (!found) throw new Error(`no button: ${text}`);
  return found as HTMLButtonElement;
}

// The section label is the exact span — never the save-as-favorite copy,
// which legitimately contains the word.
function hasFavoritesLabel(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll("span")).some(
    (s) => (s.textContent || "").trim() === "Favorites"
  );
}

function chipByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === text
  );
  if (!found) throw new Error(`no chip: ${text}`);
  return found as HTMLButtonElement;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function openAdd() {
  const add = document.querySelector('button[aria-label="Add task"]') as HTMLButtonElement;
  expect(add).toBeTruthy();
  await act(async () => { add.click(); });
  await settle();
}

const TPL_DOG: TaskTemplateConfigItem = {
  id: "tpl-dog", title: "Walk dog", points: 12, category: "Pets", priority: "high",
  mode: "assigned", assigneeName: "Emily",
};
const TPL_TRASH: TaskTemplateConfigItem = {
  id: "tpl-trash", title: "Take out trash", points: 8, category: "Chores", priority: "medium",
  mode: "open", speedBonus: 2,
};

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })));
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  seedWeek();
});

describe("Task 7 — favorites (templates) UI", () => {
  it("1. no templates in the store → no Favorites label in the Add sheet", async () => {
    await renderParent();
    await openAdd();
    expect(hasFavoritesLabel(dialogAt())).toBe(false);
  });

  it("2. seeded templates render as chips in store order; a chip prefills title and points", async () => {
    saveTaskTemplates([TPL_DOG, TPL_TRASH]);
    await renderParent();
    await openAdd();
    const d = dialogAt();
    expect(hasFavoritesLabel(d)).toBe(true);

    const buttons = Array.from(d.querySelectorAll("button"));
    const dogIdx = buttons.findIndex((b) => (b.textContent || "").trim() === "Walk dog");
    const trashIdx = buttons.findIndex((b) => (b.textContent || "").trim() === "Take out trash");
    expect(dogIdx).toBeGreaterThanOrEqual(0);
    expect(trashIdx).toBeGreaterThan(dogIdx);

    await act(async () => { chipByText(d, "Walk dog").click(); });
    await settle();

    const after = dialogAt();
    const titleInput = after.querySelector('input[placeholder="Task title"]') as HTMLInputElement;
    expect(titleInput.value).toBe("Walk dog");
    // The points Stepper shows the template's points, not the form default (5).
    const dec = after.querySelector('button[aria-label="Decrease Points"]') as HTMLButtonElement;
    expect(dec.parentElement?.textContent).toContain("12");
  });

  it("3. save-as-favorite queues the task add AND a task-templates replace carrying the form", async () => {
    await renderParent();
    await openAdd();
    const d = dialogAt();
    await act(async () => {
      typeInto(d.querySelector('input[placeholder="Task title"]') as HTMLInputElement, "Bathe the dog");
    });
    const toggle = d.querySelector('input[type="checkbox"][aria-label="⭐ Save as favorite"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    await act(async () => { buttonByText(dialogAt(), "Save").click(); });
    await settle(160);

    const entries = listTaskOutbox();
    const manage = entries.find((e) => e.route === "/api/tasks/manage" && e.action === "add");
    const config = entries.find((e) => e.route === "/api/tasks/config");
    expect(manage).toBeTruthy();
    expect(config).toBeTruthy();
    expect(config).toMatchObject({ route: "/api/tasks/config", action: "replace" });
    expect(config!.payload).toMatchObject({ kind: "task-templates" });

    // The sheet-local state never rides the task payload.
    expect(manage!.payload).toMatchObject({
      task: { title: "Bathe the dog", points: 5, category: "Chores", priority: "medium", assignee: "Rebecca (Mom)" },
    });
    const task = (manage!.payload as any).task;
    expect(task.saveAsFavorite).toBeUndefined();
    expect(task.templateId).toBeUndefined();

    const items = config!.payload.items as any[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Bathe the dog", points: 5, category: "Chores", priority: "medium",
      mode: "assigned", assigneeName: "Rebecca (Mom)",
    });
    // The new favorite is traceable to the manage command that created it...
    expect(items[0].id).toBe(`tpl-${manage!.operationId}`);
    // ...but the config write owns a distinct outbox key: the outbox is keyed by
    // operationId, so a SHARED key would make the second enqueue replace the
    // first (one of the two commands would silently never send/retry).
    expect(config!.operationId).not.toBe(manage!.operationId);
  });

  it("4. the manage sheet queues a templates replace that drops the deleted favorite", async () => {
    saveTaskTemplates([TPL_DOG, TPL_TRASH]);
    await renderParent();
    await openAdd();
    const manageBtn = dialogAt().querySelector('button[aria-label="Manage Walk dog"]') as HTMLButtonElement;
    expect(manageBtn).toBeTruthy();
    await act(async () => { manageBtn.click(); });
    await settle();

    // The manage sheet is portaled after the Add sheet.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const sheet = dialogs[dialogs.length - 1] as HTMLElement;
    expect(sheet.textContent).toMatch(/Delete favorite/);
    await act(async () => { buttonByText(sheet, "Delete favorite").click(); });
    await settle(160);

    const config = listTaskOutbox().find((e) => e.route === "/api/tasks/config");
    expect(config).toMatchObject({ action: "replace" });
    const items = config!.payload.items as any[];
    expect(items.map((i) => i.id)).toEqual(["tpl-trash"]);
    // The local list adopts the change OPTIMISTICALLY — a queued sibling edit
    // must compose from the page state, not an ack-only store. The outbox
    // entry is the durable command; the ack's strictly-newer adoption is the
    // reconciler.
    expect(loadTaskTemplates().map((t) => t.id)).toEqual(["tpl-trash"]);
  });

  it("5. a template whose assigneeName resolves to a pet leaves the assignee untouched", async () => {
    saveTaskTemplates([{
      id: "tpl-pet", title: "Feed Biscuit", points: 6, category: "Pets", priority: "low",
      mode: "assigned", assigneeName: "Biscuit",
    }]);
    await renderParent();
    await openAdd();
    await act(async () => { chipByText(dialogAt(), "Feed Biscuit").click(); });
    await settle();

    const d = dialogAt();
    expect((d.querySelector('input[placeholder="Task title"]') as HTMLInputElement).value).toBe("Feed Biscuit");
    const assignee = d.querySelector("select") as HTMLSelectElement;
    expect(assignee.value).toBe("Rebecca (Mom)");
    expect(Array.from(assignee.options).map((o) => o.value)).not.toContain("Biscuit");
  });

  it("6. the expiry control is 0=Never, rides the task payload, and hides under Recurring", async () => {
    await renderParent();
    await openAdd();
    const inc = () => dialogAt().querySelector('button[aria-label="Increase Auto-remove if unfinished"]') as HTMLButtonElement;
    expect(inc()).toBeTruthy();
    await act(async () => { inc().click(); });
    await act(async () => { inc().click(); });
    expect(inc().parentElement?.textContent).toContain("2");

    await act(async () => {
      typeInto(dialogAt().querySelector('input[placeholder="Task title"]') as HTMLInputElement, "Clean garage");
    });
    await act(async () => { buttonByText(dialogAt(), "Save").click(); });
    await settle(160);
    const manage = listTaskOutbox().find((e) => e.route === "/api/tasks/manage" && e.action === "add");
    expect((manage!.payload as any).task.expiresAfterDays).toBe(2);

    // A recurring chore never expires — the control hides.
    await openAdd();
    const recurring = Array.from(dialogAt().querySelectorAll("select")).find(
      (s) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === "Daily")
    ) as HTMLSelectElement;
    await act(async () => { selectValue(recurring, "Daily"); });
    await settle();
    expect(dialogAt().querySelector('button[aria-label="Increase Auto-remove if unfinished"]')).toBeNull();
  });

  it("7. switching Recurring clears a set expiry so the queued add carries null", async () => {
    await renderParent();
    await openAdd();
    const inc = () => dialogAt().querySelector('button[aria-label="Increase Auto-remove if unfinished"]') as HTMLButtonElement;
    await act(async () => { inc().click(); });
    await act(async () => { inc().click(); });
    expect(inc().parentElement?.textContent).toContain("2");

    const recurring = Array.from(dialogAt().querySelectorAll("select")).find(
      (s) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === "Daily")
    ) as HTMLSelectElement;
    await act(async () => { selectValue(recurring, "Daily"); });
    await act(async () => {
      typeInto(dialogAt().querySelector('input[placeholder="Task title"]') as HTMLInputElement, "Water plants");
    });
    await act(async () => { buttonByText(dialogAt(), "Save").click(); });
    await settle(160);

    // The server refuses recurring + non-null expiry; the queued add must be
    // created, with the stale hidden value cleared.
    const manage = listTaskOutbox().find((e) => e.route === "/api/tasks/manage" && e.action === "add");
    expect(manage).toBeTruthy();
    expect((manage!.payload as any).task).toMatchObject({
      title: "Water plants",
      recurring: "Daily",
      expiresAfterDays: null,
    });
  });

  it("8. queued favorites compose optimistically: two saves keep both, two deletes drop both", async () => {
    await renderParent();

    // Save A, then Save B — no ack in between (the fetch stub never succeeds).
    for (const title of ["Chore A", "Chore B"]) {
      await openAdd();
      await act(async () => {
        typeInto(dialogAt().querySelector('input[placeholder="Task title"]') as HTMLInputElement, title);
      });
      await act(async () => {
        (dialogAt().querySelector('input[type="checkbox"][aria-label="⭐ Save as favorite"]') as HTMLInputElement).click();
      });
      await act(async () => { buttonByText(dialogAt(), "Save").click(); });
      await settle(160);
    }
    const configEntries = () => listTaskOutbox().filter((e) => e.route === "/api/tasks/config");
    const saved = configEntries().at(-1)!.payload.items as any[];
    expect(saved.map((i) => i.title)).toEqual(["Chore A", "Chore B"]);

    // Delete A, then Delete B — again with no ack in between. The second
    // replace must not reshape the first deleted row back in.
    await openAdd();
    for (const title of ["Chore A", "Chore B"]) {
      const manageBtn = dialogAt().querySelector(`button[aria-label="Manage ${title}"]`) as HTMLButtonElement;
      expect(manageBtn).toBeTruthy();
      await act(async () => { manageBtn.click(); });
      await settle(160);
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const sheet = dialogs[dialogs.length - 1] as HTMLElement;
      await act(async () => { buttonByText(sheet, "Delete favorite").click(); });
      await settle(160);
    }
    const deleted = configEntries().at(-1)!.payload.items as any[];
    expect(deleted).toEqual([]);
  });

  it("9. editing a PB-sourced task with a stored 0 expiry queues expiresAfterDays: null, not 0", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([{
      id: 42,
      title: "Eat leftovers",
      assignee: "Rebecca (Mom)",
      assigneeEmoji: "👩",
      due: "2026-09-30",
      points: 5,
      recurring: null,
      category: "Chores",
      completed: false,
      priority: "medium",
      universal: false,
      stealable: false,
      crewSize: null,
      crew: null,
      crewCloseMode: null,
      expiresAfterDays: 0,
    }]));
    await renderParent();

    // Edit is the parent-only LEFT SWIPE on the row (there is no Edit button).
    const row = document.querySelector('[aria-label="Complete Eat leftovers"]') as HTMLElement;
    expect(row).toBeTruthy();
    const opts = (x: number) => ({ bubbles: true, pointerId: 1, clientX: x });
    await act(async () => {
      const event = window.PointerEvent || window.Event;
      row.dispatchEvent(new event("pointerdown", opts(300) as never));
      row.dispatchEvent(new event("pointermove", opts(180) as never));
      row.dispatchEvent(new event("pointerup", opts(160) as never));
    });
    await settle();
    await act(async () => {
      typeInto(dialogAt().querySelector('input[placeholder="Task title"]') as HTMLInputElement, "Eat leftovers tonight");
    });
    await act(async () => { buttonByText(dialogAt(), "Save").click(); });
    await settle(160);

    // Explicit 0 is refused by the server (its stored-0 tolerance only covers
    // an OMITTED key), so the queued patch must carry null.
    const update = listTaskOutbox().find((e) => e.route === "/api/tasks/manage" && e.action === "update");
    expect(update).toBeTruthy();
    const patch = (update!.payload as any).patch;
    expect(patch.title).toBe("Eat leftovers tonight");
    expect(patch.expiresAfterDays).toBeNull();
    expect(patch.expiresAfterDays).not.toBe(0);
  });
});
