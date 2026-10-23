import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ authorizeCurrentParentRequest: vi.fn() }));
const service = vi.hoisted(() => ({
  createFamilyEvent: vi.fn(),
  updateFamilyEvent: vi.fn(),
  deleteFamilyEvent: vi.fn(),
  retryFamilyEventGoogle: vi.fn(),
  EventValidationError: class extends Error {
    field: string;
    constructor(field: string, message: string) {
      super(message);
      this.field = field;
    }
  },
}));

vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: auth.authorizeCurrentParentRequest }));
vi.mock("@/lib/calendar/event-service", () => ({
  createFamilyEvent: service.createFamilyEvent,
  updateFamilyEvent: service.updateFamilyEvent,
  deleteFamilyEvent: service.deleteFamilyEvent,
  retryFamilyEventGoogle: service.retryFamilyEventGoogle,
  EventValidationError: service.EventValidationError,
}));

import { POST } from "@/app/api/calendar/events/route";
import { DELETE, PATCH } from "@/app/api/calendar/events/[id]/route";
import { POST as RETRY_GOOGLE } from "@/app/api/calendar/events/[id]/retry-google/route";

beforeEach(() => {
  vi.clearAllMocks();
  auth.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "p1", role: "parent" } });
});

const input = {
  title: "Dentist",
  date: "2026-10-21",
  startTime: "09:00",
  endTime: "10:00",
  allDay: false,
  member: "Mia",
  location: "",
  notes: "",
  notify: false,
};

describe("POST /api/calendar/events", () => {
  it("rejects a non-parent", async () => {
    auth.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await POST(new NextRequest("http://localhost/api/calendar/events", {
      method: "POST", body: JSON.stringify({ title: "x", date: "2026-10-21" }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
    expect(service.createFamilyEvent).not.toHaveBeenCalled();
  });

  it("maps validation failure to 400", async () => {
    service.createFamilyEvent.mockRejectedValue(new service.EventValidationError("title", "Add a title."));
    const res = await POST(new NextRequest("http://localhost/api/calendar/events", {
      method: "POST", body: JSON.stringify({ title: "", date: "2026-10-21" }),
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("validation");
    expect(body.field).toBe("title");
    expect(body.message).toBe("Add a title.");
  });

  it("returns the saved row and pending Google status", async () => {
    service.createFamilyEvent.mockResolvedValue({
      event: { id: "e1", title: "Dentist", date: "2026-10-21", googleSyncStatus: "pending" },
        google: { status: "pending", error: "Google Calendar isn't connected." },
    });
    const res = await POST(new NextRequest("http://localhost/api/calendar/events", {
      method: "POST", body: JSON.stringify({ title: "Dentist", date: "2026-10-21" }),
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).event.id).toBe("e1");
  });
});

describe("PATCH /api/calendar/events/:id", () => {
  it("rejects a non-parent", async () => {
    auth.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await PATCH(new NextRequest("http://localhost/api/calendar/events/e1", {
      method: "PATCH", body: JSON.stringify(input),
    }));
    expect(res.status).toBe(403);
    expect(service.updateFamilyEvent).not.toHaveBeenCalled();
  });

  it("maps validation failure to 400", async () => {
    service.updateFamilyEvent.mockRejectedValue(new service.EventValidationError("endTime", "End time must be after the start time."));
    const res = await PATCH(new NextRequest("http://localhost/api/calendar/events/e1", {
      method: "PATCH", body: JSON.stringify(input),
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: "validation", field: "endTime" });
  });

  it("maps an unknown id to 404", async () => {
    service.updateFamilyEvent.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    const res = await PATCH(new NextRequest("http://localhost/api/calendar/events/missing", {
      method: "PATCH", body: JSON.stringify(input),
    }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("maps a PB outage to 503", async () => {
    service.updateFamilyEvent.mockRejectedValue(new Error("pb down"));
    const res = await PATCH(new NextRequest("http://localhost/api/calendar/events/e1", {
      method: "PATCH", body: JSON.stringify(input),
    }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("event_save_failed");
  });

  it("returns the updated row", async () => {
    service.updateFamilyEvent.mockResolvedValue({
      event: { id: "e1", title: "Updated", date: "2026-10-22" },
      google: { status: "synced", eventId: "g1" },
    });
    const res = await PATCH(new NextRequest("http://localhost/api/calendar/events/e1", {
      method: "PATCH", body: JSON.stringify(input),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.event.title).toBe("Updated");
  });
});

describe("DELETE /api/calendar/events/:id", () => {
  it("rejects a non-parent", async () => {
    auth.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await DELETE(new NextRequest("http://localhost/api/calendar/events/e1", { method: "DELETE" }));
    expect(res.status).toBe(403);
    expect(service.deleteFamilyEvent).not.toHaveBeenCalled();
  });

  it("deletes the family row and reports a failed Google leg", async () => {
    service.deleteFamilyEvent.mockResolvedValue({
      deleted: true,
      google: { status: "failed", error: "Google Calendar couldn't save this event." },
    });
    const res = await DELETE(new NextRequest("http://localhost/api/calendar/events/e1", { method: "DELETE" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, deleted: true });
    expect(body.google.status).toBe("failed");
  });
});

describe("POST /api/calendar/events/:id/retry-google", () => {
  it("rejects a non-parent", async () => {
    auth.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const res = await RETRY_GOOGLE(new NextRequest("http://localhost/api/calendar/events/e1/retry-google", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(service.retryFamilyEventGoogle).not.toHaveBeenCalled();
  });

  it("returns the retried row", async () => {
    service.retryFamilyEventGoogle.mockResolvedValue({
      event: { id: "e1", googleSyncStatus: "synced" },
      google: { status: "synced", eventId: "g1" },
    });
    const res = await RETRY_GOOGLE(new NextRequest("http://localhost/api/calendar/events/e1/retry-google", { method: "POST" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.google).toMatchObject({ status: "synced", eventId: "g1" });
  });
});
