// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import DailyQuestCard from "@/components/leaderboard/DailyQuestCard";
import MemberSheet from "@/components/leaderboard/MemberSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/webp;base64,UklGRkIZAABXRUJQVlA4WAoAAAAQREBEQA==";

Element.prototype.scrollIntoView = vi.fn() as any;

let activeRoot: Root | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

async function settle(ms = 250) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("DailyQuestCard photo avatars", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("renders a photo assigneeEmoji as an <img>, not raw base64 text", () => {
    const el = render(
      <DailyQuestCard
        quests={[{ id: 1, title: "Walk the dog", assignee: "Emily", assigneeEmoji: PHOTO, points: 5 }]}
        onAccept={() => {}}
        onGoToTasks={() => {}}
      />
    );
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.textContent).not.toContain("data:image");
  });

  it("still renders plain emoji assignees as emoji", () => {
    const el = render(
      <DailyQuestCard
        quests={[{ id: 1, title: "Make your bed", assignee: "Caspian", assigneeEmoji: "🧒", points: 5 }]}
        onAccept={() => {}}
        onGoToTasks={() => {}}
      />
    );
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("🧒");
  });
});

describe("MemberSheet pending-task photo avatars", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
  });

  it("renders a photo assigneeEmoji as an <img>, not raw base64 text", async () => {
    const el = render(
      <MemberSheet
        open
        entry={{ name: "Emily", emoji: "👧", streak: 2, rank: 1, levelEmoji: "⭐", levelTitle: "Champ" }}
        allTimePoints={120}
        allTimeComps={30}
        weeklyPoints={40}
        pendingTasks={[{ id: 1, title: "Feed the cat", assignee: "Emily", assigneeEmoji: PHOTO, points: 5 }]}
        affordableRewards={[]}
        weekGraph={[{ day: "M", points: 10 }, { day: "T", points: 20 }]}
        onClose={() => {}}
        getMemberColor={() => "rose"}
      />
    );
    await settle();
    const imgs = Array.from(el.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.some((i) => i.getAttribute("src") === PHOTO)).toBe(true);
    expect(el.textContent).not.toContain("data:image");
  });
});
