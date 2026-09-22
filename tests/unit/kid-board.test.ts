import { describe, it, expect } from "vitest";
import {
  kidBoardState,
  splitKidBoard,
  crewAvatars,
  crewProgressLabel,
  crewWaitingNames,
} from "@/modes/kid/kid-board";

const ROSTER = [
  { name: "Caspian Garcia", emoji: "🧒", color: "green" },
  { name: "Emily Garcia", emoji: "data:image/webp;base64,AAAA", color: "rose" },
];

const joinableCrew = {
  id: 1, title: "Wash the car", points: 15, completed: false, crewSize: 3,
  crew: { members: [{ name: "Emily Garcia", emoji: "👧", joinedAt: "2026-09-20T00:00:00.000Z" }] },
};
const joinedCrew = {
  id: 2, title: "Bake cookies", points: 20, completed: false, crewSize: 3,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "2026-09-20T00:00:00.000Z" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-20T00:00:00.000Z" },
  ] },
};
const checkedInCrew = {
  ...joinedCrew,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "2026-09-20T00:00:00.000Z" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-20T00:00:00.000Z", checkedInAt: "2026-09-21T00:00:00.000Z" },
  ] },
};
const allDoneCrew = {
  id: 3, title: "Art project", points: 10, completed: false, crewSize: 2,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "2026-09-20T00:00:00.000Z", checkedInAt: "2026-09-21T00:00:00.000Z" },
    { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-20T00:00:00.000Z", checkedInAt: "2026-09-21T00:00:00.000Z" },
  ] },
};
const fullCrewNotMine = {
  id: 4, title: "Rake leaves", points: 18, completed: false, crewSize: 2,
  crew: { members: [
    { name: "Emily Garcia", emoji: "👧", joinedAt: "x" },
    { name: "Bailey Garcia", emoji: "🧒", joinedAt: "x" },
  ] },
};

describe("kidBoardState", () => {
  it("classifies crew lifecycle states", () => {
    expect(kidBoardState(joinableCrew, "Caspian Garcia")).toBe("joinable");
    expect(kidBoardState(joinedCrew, "Caspian Garcia")).toBe("joined");
    expect(kidBoardState(checkedInCrew, "Caspian Garcia")).toBe("checked-in");
    expect(kidBoardState(allDoneCrew, "Caspian Garcia")).toBe("all-done");
  });
  it("hides a full crew the kid is not in, and completed tasks", () => {
    expect(kidBoardState(fullCrewNotMine, "Caspian Garcia")).toBeNull();
    expect(kidBoardState({ ...joinableCrew, completed: true }, "Caspian Garcia")).toBeNull();
  });
  it("classifies open tasks and ignores plain assigned ones", () => {
    expect(kidBoardState({ id: 9, title: "Trash", points: 12, universal: true, completed: false }, "Caspian Garcia")).toBe("open");
    expect(kidBoardState({ id: 10, title: "Old chore", points: 5, stealable: true, due: "2000-01-01", completed: false }, "Caspian Garcia")).toBe("open");
    expect(kidBoardState({ id: 11, title: "My chore", points: 5, assignee: "Caspian", completed: false }, "Caspian Garcia")).toBeNull();
  });
});

describe("splitKidBoard", () => {
  it("partitions crews/open, drops nulls, leads with joinable then points", () => {
    const assigned = { id: 99, title: "Mine", points: 5, completed: false, assignee: "Caspian" };
    const { crews, open } = splitKidBoard(
      [assigned, fullCrewNotMine, joinedCrew, joinableCrew, allDoneCrew,
        { id: 90, title: "Trash", points: 12, universal: true, completed: false },
        { id: 91, title: "Sweep", points: 8, universal: true, completed: false }],
      "Caspian Garcia",
    );
    expect(crews.map((t) => t.title)).toEqual(["Wash the car", "Bake cookies", "Art project"]);
    expect(open.map((t) => t.title)).toEqual(["Trash", "Sweep"]);
  });
});

describe("crewAvatars", () => {
  it("resolves live roster emoji/color and marks check-ins", () => {
    const avatars = crewAvatars(checkedInCrew, ROSTER);
    expect(avatars).toEqual([
      { name: "Emily Garcia", emoji: "data:image/webp;base64,AAAA", color: "rose", checkedIn: false },
      { name: "Caspian Garcia", emoji: "🧒", color: "green", checkedIn: true },
    ]);
  });
  it("falls back to the stored emoji + neutral color for a deleted member", () => {
    const [avatar] = crewAvatars(joinableCrew, ROSTER.filter((r) => r.name !== "Emily Garcia").map((r) => ({ ...r, name: "Someone Else" })));
    expect(avatar.emoji).toBe("👧");
    expect(avatar.color).toBe("green");
  });
});

describe("crew labels", () => {
  it("progress label reads joined / total", () => {
    expect(crewProgressLabel(joinableCrew)).toBe("1 of 3 joined");
  });
  it("waiting names exclude me and only list un-checked-in members (first names)", () => {
    expect(crewWaitingNames(checkedInCrew, "Caspian Garcia")).toEqual(["Emily"]);
    expect(crewWaitingNames(allDoneCrew, "Caspian Garcia")).toEqual([]);
  });
});
