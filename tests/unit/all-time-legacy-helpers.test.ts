// @vitest-environment jsdom
// The localStorage all-time helpers are RETIRED for production display: every
// user-visible all-time number now comes from the PB-backed service. They stay
// exported for migration/cache tooling only, so this file pins both halves —
// no production caller, and the retired behavior still intact for tooling.
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ARCHIVE_KEY,
  TASKS_STORAGE_KEY,
  WEEK_DATA_KEY,
  getMemberAllTimeCompletions,
  getMemberAllTimePoints,
} from "@/lib/task-utils";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const RETIRED = ["getMemberAllTimePoints", "getMemberAllTimeCompletions"];

beforeEach(() => {
  localStorage.clear();
});

describe("retired local all-time helpers", () => {
  it("no production source imports them any more", () => {
    const offenders = sourceFiles("src")
      .filter((file) => file !== "src/lib/task-utils.ts")
      .filter((file) => RETIRED.some((name) => readFileSync(file, "utf8").includes(name)));
    expect(offenders).toEqual([]);
  });

  it("still sums the stored points maps for migration tooling", () => {
    localStorage.setItem(
      WEEK_DATA_KEY,
      JSON.stringify({ weekStart: "2026-09-21", points: { Emily: 10 }, streak: {}, lastActive: {}, history: [] })
    );
    localStorage.setItem(
      ARCHIVE_KEY,
      JSON.stringify({
        "2026-09-14": { weekStart: "2026-09-14", points: { Emily: 40 }, streak: {}, lastActive: {}, history: [] },
      })
    );
    const week = JSON.parse(localStorage.getItem(WEEK_DATA_KEY)!);
    expect(getMemberAllTimePoints("Emily", week)).toBe(50);
  });

  it("still counts stored earns for migration tooling", () => {
    const week = { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] };
    localStorage.setItem(
      ARCHIVE_KEY,
      JSON.stringify({
        "2026-09-14": {
          weekStart: "2026-09-14",
          points: {},
          streak: {},
          lastActive: {},
          history: [
            { id: 1, timestamp: "2026-09-14T10:00:00.000Z", member: "Emily", type: "earn", amount: 5, description: "x" },
            { id: 2, timestamp: "2026-09-14T11:00:00.000Z", member: "Emily", type: "penalty", amount: -5, description: "y" },
          ],
        },
      })
    );
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify([]));
    expect(getMemberAllTimeCompletions("Emily", [], week)).toBe(1);
  });
});
