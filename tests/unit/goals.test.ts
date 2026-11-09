import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTwoWeekCycle,
  isMemberMatch,
  deriveCyclePoints,
  DEFAULT_TARGETS,
  toISODate,
} from "@/lib/goals";

describe("Kids Goals System", () => {
  describe("getTwoWeekCycle", () => {
    it("anchors to 2026-11-09 on Day 1 of Cycle 1", () => {
      const cycle = getTwoWeekCycle("2026-11-09");
      expect(cycle.cycleStart).toBe("2026-11-09");
      expect(cycle.cycleEnd).toBe("2026-11-22");
      expect(cycle.week1Start).toBe("2026-11-09");
      expect(cycle.week2Start).toBe("2026-11-16");
      expect(cycle.daysRemaining).toBeGreaterThanOrEqual(13);
    });

    it("keeps the same 2-week cycle in week 2 (e.g. 2026-11-18)", () => {
      const cycle = getTwoWeekCycle("2026-11-18");
      expect(cycle.cycleStart).toBe("2026-11-09");
      expect(cycle.cycleEnd).toBe("2026-11-22");
      expect(cycle.week1Start).toBe("2026-11-09");
      expect(cycle.week2Start).toBe("2026-11-16");
    });

    it("advances to the next 2-week cycle on 2026-11-23", () => {
      const cycle = getTwoWeekCycle("2026-11-23");
      expect(cycle.cycleStart).toBe("2026-11-23");
      expect(cycle.cycleEnd).toBe("2026-12-06");
      expect(cycle.week1Start).toBe("2026-11-23");
      expect(cycle.week2Start).toBe("2026-11-30");
    });
  });

  describe("isMemberMatch", () => {
    const emily = { name: "Emily", fullName: "Emily Garcia" };
    const bailey = { name: "Bailey", fullName: "Bailey Garcia" };

    it("matches exact short name and full name", () => {
      expect(isMemberMatch("Emily", emily)).toBe(true);
      expect(isMemberMatch("Emily Garcia", emily)).toBe(true);
      expect(isMemberMatch("emily garcia", emily)).toBe(true);
    });

    it("does not match different family members", () => {
      expect(isMemberMatch("Bailey", emily)).toBe(false);
      expect(isMemberMatch("Bailey Garcia", emily)).toBe(false);
      expect(isMemberMatch("Emily", bailey)).toBe(false);
    });
  });

  describe("DEFAULT_TARGETS", () => {
    it("defines fair targets scaled to age and custody", () => {
      expect(DEFAULT_TARGETS["Emily Garcia"].target).toBe(40);
      expect(DEFAULT_TARGETS["Bailey Garcia"].target).toBe(40);
      expect(DEFAULT_TARGETS["Jasmine Garcia"].target).toBe(50);
      expect(DEFAULT_TARGETS["Aurora Garcia"].target).toBe(30);
      expect(DEFAULT_TARGETS["Caspian Garcia"].target).toBe(20);
      expect(DEFAULT_TARGETS["Emily Garcia"].bonus).toBe(10);
    });
  });

  describe("deriveCyclePoints", () => {
    it("sums points dynamically across week 1 and week 2", async () => {
      const mockPB = {
        collection: (name: string) => {
          if (name === "week_data") {
            return {
              getFullList: vi.fn().mockResolvedValue([
                { weekStart: "2026-11-09", points: { Emily: 15, Bailey: 20 } },
                { weekStart: "2026-11-16", points: { "Emily Garcia": 25, Bailey: 10 } },
              ]),
            };
          }
          if (name === "tasks") {
            return {
              getFullList: vi.fn().mockResolvedValue([]),
            };
          }
          return { getFullList: vi.fn().mockResolvedValue([]) };
        },
      };

      const emily = { name: "Emily", fullName: "Emily Garcia" };
      const bailey = { name: "Bailey", fullName: "Bailey Garcia" };

      const emilyPoints = await deriveCyclePoints(mockPB, emily, "2026-11-09", "2026-11-16");
      const baileyPoints = await deriveCyclePoints(mockPB, bailey, "2026-11-09", "2026-11-16");

      expect(emilyPoints).toBe(40); // 15 + 25 = 40 (Goal met!)
      expect(baileyPoints).toBe(30); // 20 + 10 = 30
    });

    it("incorporates completed task points if week_data is not yet banked", async () => {
      const mockPB = {
        collection: (name: string) => {
          if (name === "week_data") {
            return {
              getFullList: vi.fn().mockResolvedValue([]),
            };
          }
          if (name === "tasks") {
            return {
              getFullList: vi.fn().mockResolvedValue([
                { completed: true, completedInWeek: "2026-11-09", assignee: "Aurora Garcia", points: 15 },
                { completed: true, completedInWeek: "2026-11-16", assignee: "Aurora", awardedPoints: 10 },
              ]),
            };
          }
          return { getFullList: vi.fn().mockResolvedValue([]) };
        },
      };

      const aurora = { name: "Aurora", fullName: "Aurora Garcia" };
      const auroraPoints = await deriveCyclePoints(mockPB, aurora, "2026-11-09", "2026-11-16");
      expect(auroraPoints).toBe(25); // 15 + 10 = 25
    });
  });
});

