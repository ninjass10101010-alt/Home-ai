// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import KidCrewBoard from "@/modes/kid/KidCrewBoard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

const ROSTER = [
  { name: "Caspian Garcia", emoji: "🧒", color: "green" },
  { name: "Emily Garcia", emoji: "👧", color: "rose" },
];

const joinable = { id: 1, title: "Wash the car", points: 15, completed: false, crewSize: 3,
  crew: { members: [{ name: "Emily Garcia", emoji: "👧", joinedAt: "x" }] } };
const joined = { id: 2, title: "Bake cookies", points: 20, completed: false, crewSize: 3,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "x" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "x" },
  ] } };
const checkedIn = { id: 3, title: "Art project", points: 10, completed: false, crewSize: 3,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "x" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "x", checkedInAt: "y" },
  ] } };
const allDone = { id: 4, title: "Rake leaves", points: 18, completed: false, crewSize: 2,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "x", checkedInAt: "y" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "x", checkedInAt: "y" },
  ] } };
const openTask = { id: 9, title: "Take out trash", points: 12, universal: true, completed: false };

describe("KidCrewBoard", () => {
  it("renders nothing when both lists are empty", async () => {
    const el = await renderAsync(<KidCrewBoard crews={[]} open={[]} roster={ROSTER} memberName="Caspian Garcia" onAct={() => {}} />);
    expect(el.querySelector('[data-testid="kid-crew-board"]')).toBeNull();
  });

  it("renders both sections with progress, open rows and section headers", async () => {
    const el = await renderAsync(
      <KidCrewBoard crews={[joinable]} open={[openTask]} roster={ROSTER} memberName="Caspian Garcia" onAct={() => {}} />,
    );
    const text = el.textContent || "";
    expect(text).toContain("Join a crew!");
    expect(text).toContain("Wash the car");
    expect(text).toContain("1 of 3 joined");
    expect(text).toContain("Up for grabs");
    expect(text).toContain("Take out trash");
    expect(el.querySelector('[aria-label="Join crew: Wash the car"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Grab it: Take out trash"]')).not.toBeNull();
  });

  it("shows the right control per crew state", async () => {
    const el = await renderAsync(
      <KidCrewBoard crews={[joined, checkedIn, allDone]} open={[]} roster={ROSTER} memberName="Caspian Garcia" onAct={() => {}} />,
    );
    const text = el.textContent || "";
    expect(el.querySelector('[aria-label="Done my part: Bake cookies"]')).not.toBeNull();
    expect(text).toContain("Done — waiting");
    expect(text).toContain("waiting on Emily");
    expect(text).toContain("All done — waiting for a grown-up");
  });

  it("tapping a crew row calls onAct with the task", async () => {
    const onAct = vi.fn();
    const el = await renderAsync(
      <KidCrewBoard crews={[joinable]} open={[]} roster={ROSTER} memberName="Caspian Garcia" onAct={onAct} />,
    );
    await act(async () => { (el.querySelector('[aria-label="Join crew: Wash the car"]') as HTMLElement).click(); });
    expect(onAct).toHaveBeenCalledWith(joinable);
  });

  it("renders a joined member's real roster emoji (photo passthrough)", async () => {
    const photoRoster = [{ name: "Emily Garcia", emoji: "data:image/webp;base64,AAAA", color: "rose" }];
    const el = await renderAsync(
      <KidCrewBoard crews={[joinable]} open={[]} roster={photoRoster} memberName="Caspian Garcia" onAct={() => {}} />,
    );
    expect(el.querySelector("img")).not.toBeNull();
  });
});
