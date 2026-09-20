// @vitest-environment jsdom
// Kid quest language: due dates as words a 5-year-old reads, and honest
// framing for open/crew rows (never a foreign kid's name on a claimable task).
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { kidDueLabel, dueTone } from "@/modes/kid/quest-labels";
import { localTodayISO } from "@/lib/local-date";
import QuestCard from "@/modes/kid/QuestCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

describe("kidDueLabel — dates become words", () => {
  const TODAY = "2026-09-16"; // Wednesday
  it("today / tomorrow / weekday / late", () => {
    expect(kidDueLabel("2026-09-16", TODAY)).toBe("Today");
    expect(kidDueLabel("2026-09-17", TODAY)).toBe("Tomorrow");
    expect(kidDueLabel("2026-09-19", TODAY)).toBe("Saturday");
    expect(kidDueLabel("2026-09-14", TODAY)).toBe("⚠️ Late");
    expect(kidDueLabel("", TODAY)).toBe("");
    expect(kidDueLabel("garbage", TODAY)).toBe("");
  });

  it("dueTone maps to warm-glass accent tokens", () => {
    expect(dueTone("Today")).toBe("var(--color-accent-mint)");
    expect(dueTone("Tomorrow")).toBe("var(--color-accent-cyan)");
    expect(dueTone("Saturday")).toBe("var(--color-accent-cyan)");
    expect(dueTone("⚠️ Late")).toBe("var(--color-accent-rose)");
    expect(dueTone("")).toBe("var(--color-text-muted)");
  });
});

describe("QuestCard — kid language", () => {
  const TODAY = localTodayISO();
  const tomorrow = new Date(`${TODAY}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const TOMORROW = tomorrow.toISOString().slice(0, 10);

  it("shows a TODAY chip, not a raw ISO date", async () => {
    const el = await renderAsync(
      <QuestCard task={{ id: 1, title: "Help set the table", points: 8, assignee: "Aurora", due: TODAY } as any} onComplete={() => {}} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Today");
    expect(text).not.toContain(TODAY);
  });

  it("an OPEN task says 'Up for grabs', not another kid's name", async () => {
    const el = await renderAsync(
      <QuestCard task={{ id: 2, title: "Walk the Dogs", points: 10, assignee: "Jeffery", due: TODAY, universal: true } as any} onComplete={() => {}} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Up for grabs");
    expect(text).not.toContain("Jeffery");
  });

  it("a CREW task says 'Crew — join!'", async () => {
    const el = await renderAsync(
      <QuestCard task={{ id: 3, title: "Wash the van", points: 15, assignee: "Crew", due: TODAY, crewSize: 3, crew: { members: [] } } as any} onComplete={() => {}} />
    );
    expect(el.textContent).toContain("Crew");
  });

  it("an ASSIGNED quest still shows the owner's first name", async () => {
    const el = await renderAsync(
      <QuestCard task={{ id: 4, title: "Feed Rico", points: 5, assignee: "Aurora Garcia", due: TOMORROW } as any} onComplete={() => {}} />
    );
    expect(el.textContent).toContain("Aurora");
  });

  it("an overdue quest shows the Late chip in rose", async () => {
    const past = new Date(`${TODAY}T12:00:00`);
    past.setDate(past.getDate() - 3);
    const el = await renderAsync(
      <QuestCard task={{ id: 5, title: "Pick up toys", points: 5, assignee: "Aurora", due: past.toISOString().slice(0, 10) } as any} onComplete={() => {}} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Late");
    expect(el.innerHTML).toContain("var(--color-accent-rose)");
  });
});
