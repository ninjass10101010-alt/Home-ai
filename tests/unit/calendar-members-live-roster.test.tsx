// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_CALENDAR_MEMBERS,
  getServerMembersSnapshot,
  getClientMembersSnapshot,
  resetClientMembersSnapshotForTests,
  subscribeMembersSnapshot,
} from "@/lib/calendar-member-snapshot";

const rosterMock = vi.hoisted(() => ({ members: [] as any[] }));
vi.mock("@/db", () => ({
  db: {
    selectMembersForCalendar: () => rosterMock.members.map((m) => ({ ...m })),
  },
}));

describe("calendar member snapshot (live roster via consuela-members-updated)", () => {
  beforeEach(() => {
    rosterMock.members = [
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      { name: "Rebecca", color: "green", emoji: "🐱" },
    ];
    resetClientMembersSnapshotForTests();
  });

  afterEach(() => {
    resetClientMembersSnapshotForTests();
  });

  it("server snapshot stays the deterministic fallback (SSR/hydration safe)", () => {
    expect(getServerMembersSnapshot()).toBe(DEFAULT_CALENDAR_MEMBERS);
    expect(DEFAULT_CALENDAR_MEMBERS[0]).toEqual({ name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" });
  });

  it("subscribing to consuela-members-updated re-reads the roster and notifies the store", () => {
    let notified = 0;
    const unsubscribe = subscribeMembersSnapshot(() => { notified++; });

    // Client snapshot starts on the deterministic fallback.
    expect(getClientMembersSnapshot()).toEqual(DEFAULT_CALENDAR_MEMBERS);

    // The roster refreshes: Rebecca now has a photo emoji.
    rosterMock.members = [
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      { name: "Rebecca", color: "green", emoji: "PHOTO-DATA-URL" },
    ];

    window.dispatchEvent(new CustomEvent("consuela-members-updated"));

    expect(notified).toBe(1);
    expect(getClientMembersSnapshot()).toEqual([
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      { name: "Rebecca", color: "green", emoji: "PHOTO-DATA-URL" },
    ]);

    unsubscribe();
    window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    expect(notified).toBe(1);
  });
});
