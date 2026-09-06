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

describe("calendar member snapshot (live roster via priming + consuela-members-updated)", () => {
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

  it("subscribing primes the client snapshot from the live roster cache", () => {
    // Before anyone subscribes the module cache still holds the fallback —
    // but subscribe runs post-mount and React re-checks getSnapshot after
    // subscribing, so priming there is hydration-safe.
    expect(getClientMembersSnapshot()).toEqual(DEFAULT_CALENDAR_MEMBERS);

    const unsubscribe = subscribeMembersSnapshot(() => {});
    expect(getClientMembersSnapshot()).toEqual([
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      { name: "Rebecca", color: "green", emoji: "🐱" },
    ]);
    unsubscribe();
  });

  it("subscribing to consuela-members-updated re-reads the roster and notifies the store", () => {
    let notified = 0;
    const unsubscribe = subscribeMembersSnapshot(() => { notified++; });

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

  it("regression: an event dispatched while unsubscribed is healed by the next subscribe", () => {
    // The user-reported bug: startup hydrate / 60s refresh / profile saves all
    // dispatch consuela-members-updated while the Calendar is unmounted (the
    // chips sat on the hardcoded fallback for a whole session). The lost
    // event must NOT strand the next mount — subscribing re-primes from the
    // live cache.
    const first = subscribeMembersSnapshot(() => {});
    first();

    rosterMock.members = [
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      { name: "Rebecca", color: "green", emoji: "🐱" },
      { name: "Caspian", color: "cyan", emoji: "PHOTO-DATA-URL" },
    ];
    // Nobody is listening — this dispatch is lost by design.
    window.dispatchEvent(new CustomEvent("consuela-members-updated"));

    let notified = 0;
    const second = subscribeMembersSnapshot(() => { notified++; });
    expect(getClientMembersSnapshot()).toEqual(rosterMock.members);
    second();
    expect(notified).toBe(0);
  });
});
