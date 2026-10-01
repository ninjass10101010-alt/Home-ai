// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewTasksCard from "@/components/tasks/CrewTasksCard";
import TasksRewardsPanel from "@/components/tasks/TasksRewardsPanel";
import TasksStats from "@/components/tasks/TasksStats";
import type { Penalty, Reward } from "@/types/tasks";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UI audit Phase 5.7 — the Tasks page's view blocks now live in
 * `src/components/tasks/` (the page keeps all 33 `useState` and the data
 * flow). These tests pin the section props and prove the page no longer
 * carries the moved markup.
 */

const REWARDS: Reward[] = [
  { id: 1, name: "Ice cream", emoji: "🍦", cost: 20 },
  { id: 2, name: "Movie night", emoji: "🎬", cost: 150 },
];
const PENALTIES: Penalty[] = [{ id: 7, name: "Skipped trash", emoji: "🗑️", points: 5 }];

function render(ui: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => createRoot(host).render(ui));
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tasks sections (audit 5.7)", () => {
  it("TasksStats renders the counts and forwards the view switch", () => {
    const onChange = vi.fn();
    const host = render(
      createElement(TasksStats, {
        pendingCount: 3,
        completedCount: 7,
        earnedThisWeek: 42,
        allTimePoints: 310,
        allTimeRead: { state: "authoritative", updatedAt: "2026-09-28T10:00:00.000Z" },
        activeTab: "tasks",
        onChange,
      }),
    );
    expect(host.textContent).toContain("3");
    expect(host.textContent).toContain("7");
    expect(host.textContent).toContain("42");
    expect(host.textContent).toContain("310");
    const leaderboard = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Leaderboard");
    act(() => leaderboard!.click());
    expect(onChange).toHaveBeenCalledWith("leaderboard");
  });

  it("TasksRewardsPanel lists rewards and penalties and wires the actions", () => {
    const handlers = {
      onGenerateAi: vi.fn(),
      onAdd: vi.fn(),
      onAdopt: vi.fn(),
      onRedeem: vi.fn(),
      onEdit: vi.fn(),
      onAddPenalty: vi.fn(),
      onApplyPenalty: vi.fn(),
      onEditPenalty: vi.fn(),
    };
    const host = render(
      createElement(TasksRewardsPanel, {
        rewards: REWARDS,
        aiRewards: [],
        aiRewardSuggesting: false,
        penalties: PENALTIES,
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("Ice cream");
    expect(host.textContent).toContain("150 pts");
    expect(host.textContent).toContain("needs parent");
    expect(host.textContent).toContain("Skipped trash");

    const redeem = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Redeem");
    act(() => redeem!.click());
    expect(handlers.onRedeem).toHaveBeenCalledWith(REWARDS[0]);
  });

  it("CrewTasksCard stays hidden unless the parent gate is on", () => {
    const crewTask = { id: 9, title: "Rake the yard", points: 10, crew: { members: [{ name: "Alex", emoji: "🧒" }] }, crewSize: 2, completed: false, pendingApproval: false } as never;
    const hidden = render(createElement(CrewTasksCard, { tasks: [crewTask], visible: false, onRemoveMember: vi.fn(), onCloseCrew: vi.fn() }));
    expect(hidden.textContent).toBe("");
    const shown = render(createElement(CrewTasksCard, { tasks: [crewTask], visible: true, onRemoveMember: vi.fn(), onCloseCrew: vi.fn() }));
    expect(shown.textContent).toContain("Rake the yard");
    expect(shown.textContent).toContain("Alex");
  });

  it("CrewTasksCard renders a photo avatar as an image, never as base64 text", () => {
    const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";
    const crewTask = {
      id: 10,
      title: "Bake cookies",
      points: 5,
      crew: { members: [{ name: "Emily Garcia", emoji: PHOTO, joinedAt: "2026-09-24T10:00:00.000Z", checkedInAt: "2026-09-24T11:00:00.000Z" }] },
      crewSize: 2,
      completed: false,
      pendingApproval: false,
    } as never;
    const host = render(createElement(CrewTasksCard, { tasks: [crewTask], visible: true, onRemoveMember: vi.fn(), onCloseCrew: vi.fn() }));
    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(host.textContent).not.toContain("data:image");
    expect(host.textContent).not.toContain("base64");
    expect(host.textContent).toContain("Emily");
    expect(host.textContent).toContain("done");
  });

  it("the page keeps the data flow and no longer carries the moved markup", () => {
    const page = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
    expect(page, "state stays in the page").toContain("const [editingId, setEditingId]");
    expect(page, "view blocks moved out").not.toContain("Spend points on family perks");
    expect(page, "view blocks moved out").not.toContain("Manage who's on each crew");
    expect(page).toContain("<TasksRewardsPanel");
    expect(page).toContain("<TasksArchive");
    expect(page).toContain("<CrewTasksCard");
    expect(page).toContain("<TasksStats");
  });
});
