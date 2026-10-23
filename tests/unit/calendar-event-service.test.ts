import { beforeEach, describe, expect, it, vi } from "vitest";

const pb = vi.hoisted(() => ({
  create: vi.fn(),
  getOne: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getFullList: vi.fn(),
}));

const google = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  readCached: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (client: unknown) => unknown) => fn(pb),
}));

vi.mock("@/lib/keyed-lock", () => ({
  withKeyedLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/google/calendar", () => ({
  createCalendarEvent: google.create,
  deleteCalendarEvent: google.delete,
  readCachedEvents: google.readCached,
}));

import {
  EventValidationError,
  createFamilyEvent,
  deleteFamilyEvent,
  retryFamilyEventGoogle,
  retryPendingCalendarMirrors,
  updateFamilyEvent,
} from "@/lib/calendar/event-service";

const input = {
  title: "Dentist",
  date: "2026-10-21",
  startTime: "09:00",
  endTime: "10:00",
  allDay: false,
  member: "Mia",
  location: "Main St",
  notes: "Bring forms",
  notify: true,
};

const pendingRow = {
  id: "e1",
  title: "Dentist",
  date: "2026-10-21",
  time: "09:00",
  endTime: "10:00",
  allDay: false,
  member: "Mia",
  source: "family",
  googleSyncStatus: "pending",
  googleSyncError: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  google.readCached.mockResolvedValue([]);
  pb.update.mockResolvedValue({ ...pendingRow, googleSyncStatus: "synced" });
});

describe("createFamilyEvent", () => {
  it("writes PB first, mirrors, then stores the returned Google id", async () => {
    pb.create.mockResolvedValue(pendingRow);
    google.create.mockResolvedValue({ id: "g1" });

    const result = await createFamilyEvent(input);

    expect(pb.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "Dentist",
      date: "2026-10-21",
      time: "09:00",
      source: "family",
      googleSyncStatus: "pending",
    }));
    expect(google.create).toHaveBeenCalledWith(expect.objectContaining({
      summary: "Dentist",
      start: { dateTime: "2026-10-21T09:00:00", timeZone: expect.any(String) },
      end: { dateTime: "2026-10-21T10:00:00", timeZone: expect.any(String) },
    }));
    expect(pb.update).toHaveBeenCalledWith("e1", expect.objectContaining({
      googleEventId: "g1",
      googleCalendarId: "primary",
      googleSyncStatus: "synced",
    }));
    expect(result.event.googleSyncStatus).toBe("synced");
    expect(result.google).toMatchObject({ status: "synced", eventId: "g1" });
  });

  it("keeps the family row and reports a sanitized Google failure", async () => {
    pb.create.mockResolvedValue(pendingRow);
    google.create.mockRejectedValue({ code: "api_error", message: "raw secret" });

    const result = await createFamilyEvent(input);

    expect(result.event.googleSyncStatus).toBe("failed");
    expect(result.google.status).toBe("failed");
    expect(result.google.error).toBe("Google Calendar couldn't save this event.");
    expect(JSON.stringify(result)).not.toContain("raw secret");
  });

  it("leaves a not-connected mirror pending", async () => {
    pb.create.mockResolvedValue(pendingRow);
    google.create.mockRejectedValue({ code: "not_connected" });

    const result = await createFamilyEvent(input);

    expect(result.event.googleSyncStatus).toBe("pending");
    expect(result.google.error).toBe("Google Calendar isn't connected.");
  });
});

describe("updateFamilyEvent", () => {
  it("edits an unmirrored family row without calling Google", async () => {
    pb.getOne.mockResolvedValue({ ...pendingRow, googleEventId: "", googleSyncStatus: "" });
    pb.update.mockResolvedValue({ ...pendingRow, title: "Updated" });

    const result = await updateFamilyEvent("e1", { ...input, title: "Updated" });

    expect(google.delete).not.toHaveBeenCalled();
    expect(google.create).not.toHaveBeenCalled();
    expect(result.google).toMatchObject({ status: "pending", unmirrored: true });
  });

  it("recreates a mirrored Google event after deleting the old one", async () => {
    pb.getOne.mockResolvedValue({ ...pendingRow, googleEventId: "g_old", googleCalendarId: "primary" });
    pb.update.mockResolvedValue({ ...pendingRow, date: "2026-10-22", googleSyncStatus: "pending" });
    google.delete.mockResolvedValue(undefined);
    google.create.mockResolvedValue({ id: "g_new" });

    const result = await updateFamilyEvent("e1", { ...input, date: "2026-10-22" });

    expect(google.delete).toHaveBeenCalledWith("g_old");
    expect(google.create).toHaveBeenCalledWith(expect.objectContaining({
      start: { dateTime: "2026-10-22T09:00:00", timeZone: expect.any(String) },
    }));
    expect(result.google).toMatchObject({ status: "synced", eventId: "g_new" });
  });

  it("keeps the old Google id when the replacement delete fails", async () => {
    pb.getOne.mockResolvedValue({ ...pendingRow, googleEventId: "g_old", googleCalendarId: "primary" });
    pb.update.mockResolvedValue({ ...pendingRow, googleSyncStatus: "pending" });
    google.delete.mockRejectedValue({ code: "api_error" });

    const result = await updateFamilyEvent("e1", input);

    expect(google.create).not.toHaveBeenCalled();
    expect(result.event.googleSyncStatus).toBe("failed");
    expect(pb.update).toHaveBeenLastCalledWith("e1", expect.objectContaining({
      googleSyncStatus: "failed",
      googleSyncError: "Google Calendar couldn't save this event.",
    }));
  });

  it("refuses a Google-origin row", async () => {
    pb.getOne.mockResolvedValue({ ...pendingRow, source: "google" });
    await expect(updateFamilyEvent("e1", input)).rejects.toBeInstanceOf(EventValidationError);
  });
});

describe("deleteFamilyEvent", () => {
  it("still deletes PB when the Google delete fails", async () => {
    pb.getOne.mockResolvedValue({ ...pendingRow, googleEventId: "g_old", googleCalendarId: "primary" });
    google.delete.mockRejectedValue({ code: "api_error" });

    const result = await deleteFamilyEvent("e1");

    expect(pb.delete).toHaveBeenCalledWith("e1");
    expect(result.google).toMatchObject({ status: "failed" });
  });
});

describe("retry", () => {
  it("adopts a matching cached Google row instead of duplicating it", async () => {
    pb.getOne.mockResolvedValue(pendingRow);
    google.readCached.mockResolvedValue([{
      google_id: "g_existing",
      calendar_id: "primary",
      summary: "Dentist",
      start_iso: "2026-10-21T09:00:00",
      end_iso: "2026-10-21T10:00:00",
      all_day: false,
    }]);

    const result = await retryFamilyEventGoogle("e1");

    expect(google.create).not.toHaveBeenCalled();
    expect(pb.update).toHaveBeenCalledWith("e1", expect.objectContaining({
      googleEventId: "g_existing",
      googleSyncStatus: "synced",
    }));
    expect(result.google).toMatchObject({ status: "synced", eventId: "g_existing" });
  });

  it("processes at most 20 pending rows", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      ...pendingRow,
      id: `e${i}`,
      title: `Event ${i}`,
    }));
    pb.getFullList.mockResolvedValue(rows);
    google.create.mockResolvedValue({ id: "created" });

    const result = await retryPendingCalendarMirrors(20);

    expect(google.create).toHaveBeenCalledTimes(20);
    expect(result.checked).toBe(20);
  });

  it("does not abort the batch when one row fails", async () => {
    const rows = [pendingRow, { ...pendingRow, id: "e2", title: "Second" }];
    pb.getFullList.mockResolvedValue(rows);
    google.create
      .mockRejectedValueOnce({ code: "api_error" })
      .mockResolvedValueOnce({ id: "g2" });

    const result = await retryPendingCalendarMirrors(20);

    expect(result).toEqual({ checked: 2, synced: 1, failed: 1 });
  });
});
