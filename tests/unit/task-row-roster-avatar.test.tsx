// 2026-09-23 review — roster-first avatars on the remaining task-row
// surfaces: DailyQuestCard takes a rosterEmoji map (the stored assigneeEmoji
// may be the sanitized "👤" fallback; members.emoji holds the real photos)
// and MemberSheet resolves its own pending rows from the sheet entry.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

import DailyQuestCard from "@/components/leaderboard/DailyQuestCard";
import MemberSheet from "@/components/leaderboard/MemberSheet";

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  return el;
}

const QUEST = {
  id: 1, title: "Walk the dog", assignee: "Emily", assigneeEmoji: "👤", points: 5,
};

describe("DailyQuestCard roster-first avatars", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("renders the roster photo when rosterEmoji resolves the assignee", async () => {
    await renderAsync(
      <DailyQuestCard
        quests={[QUEST]}
        onAccept={vi.fn()}
        onGoToTasks={vi.fn()}
        rosterEmoji={{ Emily: PHOTO }}
      />
    );
    const img = document.body.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
  });

  it("falls back to the stored glyph when the roster has no entry (no hijack)", async () => {
    await renderAsync(
      <DailyQuestCard
        quests={[QUEST]}
        onAccept={vi.fn()}
        onGoToTasks={vi.fn()}
        rosterEmoji={{}}
      />
    );
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("👤");
  });

  it("legacy behavior preserved: no rosterEmoji prop → stored glyph", async () => {
    await renderAsync(
      <DailyQuestCard quests={[QUEST]} onAccept={vi.fn()} onGoToTasks={vi.fn()} />
    );
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("👤");
  });
});

describe("MemberSheet pending-row avatars resolve from the sheet entry", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  const baseProps = {
    open: true,
    entry: { name: "Emily", emoji: PHOTO, streak: 2, rank: 1, levelEmoji: "⭐", levelTitle: "Star" },
    allTimePoints: 40,
    allTimeComps: 6,
    weeklyPoints: 10,
    pendingTasks: [{ id: 9, title: "Walk the dog", assignee: "Emily", assigneeEmoji: "👤", points: 5 }],
    affordableRewards: [],
    weekGraph: [{ day: "M", points: 4 }, { day: "T", points: 6 }],
    onClose: vi.fn(),
    getMemberColor: () => "rose",
  };

  it("the member's own pending rows render the entry's real photo", async () => {
    await renderAsync(<MemberSheet {...baseProps} />);
    expect(document.body.textContent).toContain("Pending Tasks");
    const imgs = Array.from(document.body.querySelectorAll("img"));
    expect(imgs.some((i) => i.getAttribute("src") === PHOTO)).toBe(true);
  });

  it("a foreign assignee row keeps its stored glyph (no cross-member hijack)", async () => {
    await renderAsync(
      <MemberSheet
        {...baseProps}
        pendingTasks={[{ id: 9, title: "Walk the dog", assignee: "Jasmine", assigneeEmoji: "🌸", points: 5 }]}
      />
    );
    expect(document.body.textContent).toContain("Pending Tasks");
    expect(document.body.textContent).toContain("🌸");
    // The PENDING ROW must not carry an img — the sheet header's own photo
    // avatar (entry.emoji) is expected and unrelated.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    let rowEl: Element | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent === "Walk the dog") { rowEl = node.parentElement; break; }
    }
    expect(rowEl).toBeTruthy();
    expect(rowEl!.querySelector("img")).toBeNull();
  });
});
