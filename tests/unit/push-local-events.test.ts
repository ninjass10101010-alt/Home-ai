// @vitest-environment jsdom
// The Settings "Push local data to cloud" flow used to insert every cached
// event row as-is. The legacy cache shape has no `date`, so those rows landed
// in PocketBase with an empty date — invisible to the calendar (undated rows
// are dropped on read) and multiplied on every push. Events are now pushed
// only when they carry a usable date, and never twice.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  eventsRead: vi.fn(),
  inserted: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    selectEventsAuthoritative: h.eventsRead,
    insertEvent: async (event: any) => {
      h.inserted.push(event);
      return { ...event, id: "event-new" };
    },
    upsertGroceryItem: async () => ({ id: "grocery-new" }),
    upsertPantryItem: async () => ({ id: "pantry-new" }),
    insertMeal: async () => ({ id: "meal-new" }),
    upsertRecipe: async () => ({ id: "recipe-new" }),
    insertSchedule: async () => ({ id: "schedule-new" }),
    selectMealsAuthoritative: async () => [],
    selectSchedulesAuthoritative: async () => [],
  },
}));

import { pushLocalToPB } from "@/lib/push-local-to-pb";

function eventsResult(results: Array<{ collection: string; pushed: number; errors: number }>) {
  return results.find((result) => result.collection === "events");
}

beforeEach(() => {
  localStorage.clear();
  h.inserted.length = 0;
  h.eventsRead.mockReset().mockResolvedValue([]);
});

describe("pushLocalToPB event rows", () => {
  it("never creates an event row without a usable date", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: 1, title: "Bailey & Emily at home!", time: "3:00 PM", member: "Rebecca", day: 12 },
      { id: 2, title: "Dentist", date: "2026-10-24", time: "09:00", member: "Rebecca" },
    ]));

    const results = await pushLocalToPB();

    expect(h.inserted.map((event) => event.title)).toEqual(["Dentist"]);
    expect(eventsResult(results)).toMatchObject({ pushed: 1, errors: 0 });
  });

  it("does not push an event the server already holds", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: 1, title: "Dentist", date: "2026-10-24", time: "09:00" },
    ]));
    h.eventsRead.mockResolvedValue([{ title: "dentist", date: "2026-10-24" }]);

    const results = await pushLocalToPB();

    expect(h.inserted).toHaveLength(0);
    expect(eventsResult(results)).toMatchObject({ pushed: 0, errors: 0 });
  });

  it("pushes the same local event only once per run", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: 1, title: "Dentist", date: "2026-10-24", time: "09:00" },
      { id: 2, title: "Dentist", date: "2026-10-24", time: "10:00" },
    ]));

    const results = await pushLocalToPB();

    expect(h.inserted).toHaveLength(1);
    expect(eventsResult(results)).toMatchObject({ pushed: 1, errors: 0 });
  });

  it("reports an honest error and pushes nothing when the server event list cannot be read", async () => {
    localStorage.setItem("consuela-events", JSON.stringify([
      { id: 1, title: "Dentist", date: "2026-10-24" },
    ]));
    h.eventsRead.mockRejectedValueOnce(new Error("events read unavailable"));

    const results = await pushLocalToPB();

    expect(h.inserted).toHaveLength(0);
    expect(eventsResult(results)).toMatchObject({ pushed: 0, errors: 1 });
  });
});
