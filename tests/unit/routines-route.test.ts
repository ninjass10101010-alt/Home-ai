import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirstListItem: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: (_name: string) => ({
        getFirstListItem: mocks.getFirstListItem,
        update: mocks.update,
        create: mocks.create,
      }),
    }),
}));

import { GET as ROUTINES_GET, PUT as ROUTINES_PUT } from "@/app/api/routines/route";
import { GET as PROGRESS_GET, PUT as PROGRESS_PUT } from "@/app/api/routines/progress/route";
import { DEFAULT_ROUTINES } from "@/types/routines";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/routines", () => {
  it("returns default routines if no state record exists in pocketbase", async () => {
    mocks.getFirstListItem.mockRejectedValueOnce(new Error("Record not found"));
    const res = await ROUTINES_GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routines).toEqual(DEFAULT_ROUTINES);
  });

  it("returns stored routines when record exists", async () => {
    const custom = [{ id: "rt-test", title: "Test Routine", steps: [] }];
    mocks.getFirstListItem.mockResolvedValueOnce({
      id: "rec-1",
      value: custom,
    });

    const res = await ROUTINES_GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routines).toEqual(custom);
  });

  it("updates routines when record already exists", async () => {
    mocks.getFirstListItem.mockResolvedValueOnce({ id: "rec-1" });
    mocks.update.mockResolvedValueOnce({ id: "rec-1" });

    const req = new Request("http://localhost/api/routines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routines: [{ id: "rt-1", title: "New" }] }),
    });

    const res = await ROUTINES_PUT(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith("rec-1", {
      value: [{ id: "rt-1", title: "New" }],
    });
  });

  it("creates routines record if record does not exist yet", async () => {
    mocks.getFirstListItem.mockRejectedValueOnce(new Error("Not found"));
    mocks.create.mockResolvedValueOnce({ id: "rec-new" });

    const req = new Request("http://localhost/api/routines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routines: [{ id: "rt-1", title: "Created" }] }),
    });

    const res = await ROUTINES_PUT(req as any);
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      key: "family_routines",
      value: [{ id: "rt-1", title: "Created" }],
    });
  });
});

describe("/api/routines/progress", () => {
  it("returns empty progress when no progress has been saved for that date", async () => {
    mocks.getFirstListItem.mockRejectedValueOnce(new Error("Not found"));
    const req = new Request("http://localhost/api/routines/progress?date=2026-11-05");
    const res = await PROGRESS_GET(req as any);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.progress).toEqual({ checkedSteps: {}, completedRoutines: {} });
  });

  it("saves and returns daily progress", async () => {
    mocks.getFirstListItem.mockResolvedValueOnce({ id: "rec-prog" });
    mocks.update.mockResolvedValueOnce({ id: "rec-prog" });

    const req = new Request("http://localhost/api/routines/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-11-05",
        progress: {
          checkedSteps: { "rt-1": ["s1"] },
          completedRoutines: { "rt-1": false },
        },
      }),
    });

    const res = await PROGRESS_PUT(req as any);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.date).toBe("2026-11-05");
    expect(mocks.update).toHaveBeenCalledWith("rec-prog", {
      value: {
        checkedSteps: { "rt-1": ["s1"] },
        completedRoutines: { "rt-1": false },
      },
    });
  });
});
