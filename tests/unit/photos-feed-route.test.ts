// GET/PATCH /api/photos — the feed fixes (spec §3.7 window rule, `all=1`
// honesty) and the PATCH live-identity gate. The PB seam (withAdmin), the
// curator, and verifyLiveParentSession are mocked; assertions are on what the
// route asks for (pages, sorts, curate options) and what it hands back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  curate: vi.fn(),
  verifyLiveParentSession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/photos/curate", () => ({
  curateWallPhotos: (photos: unknown[], options: unknown) => mocks.curate(photos, options),
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: (request: unknown) => mocks.verifyLiveParentSession(request),
}));

import { GET, PATCH } from "@/app/api/photos/route";

const VALID_ID = "abc123def456ghi";

type Row = Record<string, unknown>;

function row(id: string, takenAt: string, over: Row = {}): Row {
  return {
    id,
    takenAt,
    wall: `${id}.jpg`,
    original: `${id}.jpg`,
    width: 1600,
    height: 1000,
    showOnWall: true,
    ...over,
  };
}

/** Fake PB whose `photos.getList(page, perPage, opts)` serves canned pages. */
function feedPb(pages: Row[][]) {
  const getList = vi.fn(async (page: number) => ({ items: pages[page - 1] ?? [] }));
  const update = vi.fn(async () => ({}));
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: (name: string) => {
        if (name !== "photos") throw new Error(`unexpected collection: ${name}`);
        return { getList, update };
      },
    }),
  );
  return { getList, update };
}

function getReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/photos${query}`, { method: "GET" });
}

function patchReq(body: unknown, cookie = "consuela_session=parent%7CRebecca%7Cm-reb"): NextRequest {
  return new NextRequest("http://localhost/api/photos", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.curate.mockReset();
  mocks.curate.mockImplementation((photos: unknown[]) => photos);
  mocks.verifyLiveParentSession.mockReset();
  mocks.verifyLiveParentSession.mockResolvedValue({
    ok: true,
    member: { id: "m-reb", name: "Rebecca", role: "parent" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET — the curate window", () => {
  it("paginates past the old newest-60 cap so curation sees the whole library", async () => {
    const page1 = Array.from({ length: 60 }, (_, i) => row(`p${String(i).padStart(2, "0")}`, "2026-01-01T00:00:00.000Z"));
    const page2 = Array.from({ length: 10 }, (_, i) => row(`q${i}`, "2026-01-02T00:00:00.000Z"));
    const { getList } = feedPb([page1, page2]);

    const res = await GET(getReq(""));
    expect(res.status).toBe(200);
    expect(getList).toHaveBeenCalledTimes(2);
    expect(getList).toHaveBeenNthCalledWith(1, 1, 60, {
      sort: "-takenAt",
      filter: "showOnWall = true",
    });
    expect(getList).toHaveBeenNthCalledWith(2, 2, 60, {
      sort: "-takenAt",
      filter: "showOnWall = true",
    });
    expect(mocks.curate).toHaveBeenCalledTimes(1);
    expect(mocks.curate.mock.calls[0][0]).toHaveLength(70);
    expect(mocks.curate.mock.calls[0][1]).toMatchObject({ limit: 12, order: "shuffle" });
  });

  it("stops at the 20-page bound even when every page comes back full", async () => {
    const full = Array.from({ length: 60 }, (_, i) => row(`p${i}`, "2026-01-01T00:00:00.000Z"));
    const { getList } = feedPb(Array.from({ length: 30 }, () => full));

    await GET(getReq(""));
    expect(getList).toHaveBeenCalledTimes(20);
    expect(mocks.curate.mock.calls[0][0]).toHaveLength(1200);
  });

  it("floors a fractional limit before clamping", async () => {
    const { getList } = feedPb([[row("a", "2026-01-01T00:00:00.000Z")]]);

    await GET(getReq("?limit=3.9"));
    expect(mocks.curate.mock.calls[0][1]).toMatchObject({ limit: 3 });

    await GET(getReq("?limit=999"));
    expect(mocks.curate.mock.calls[1][1]).toMatchObject({ limit: 40 });

    // A full page was fetched for each call above; nothing else changed.
    expect(getList).toHaveBeenCalledTimes(2);
  });

  it("sorts ascending for order=oldest (spec §3.7: the window follows the order)", async () => {
    const { getList } = feedPb([[row("a", "2026-01-01T00:00:00.000Z")]]);

    await GET(getReq("?order=oldest"));
    expect(getList).toHaveBeenNthCalledWith(1, 1, 60, {
      sort: "takenAt",
      filter: "showOnWall = true",
    });
    expect(mocks.curate.mock.calls[0][1]).toMatchObject({ order: "oldest" });
  });

  it("sorts newest-first for order=newest and defaults to shuffle with no param", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getList } = feedPb([[row("a", "2026-01-01T00:00:00.000Z")]]);

    await GET(getReq("?order=newest"));
    expect(getList).toHaveBeenNthCalledWith(1, 1, 60, {
      sort: "-takenAt",
      filter: "showOnWall = true",
    });
    expect(mocks.curate.mock.calls[0][1]).toMatchObject({ order: "newest" });

    await GET(getReq(""));
    expect(mocks.curate.mock.calls[1][1]).toMatchObject({ order: "shuffle" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects an unknown order with 400 invalid_order instead of silently shuffling", async () => {
    // A silent fallback makes the client think its choice stuck while the wall
    // shuffles anyway (spec §3.7 / plan T5 step 3 — decided: reject).
    const { getList } = feedPb([[row("a", "2026-01-01T00:00:00.000Z")]]);

    const res = await GET(getReq("?order=sideways"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_order" });
    expect(getList).not.toHaveBeenCalled();
    expect(mocks.curate).not.toHaveBeenCalled();

    // Validation is unconditional: `all=1` ignores order too, but a bad value
    // is still a bad value and must not silently pass either.
    const grid = await GET(getReq("?all=1&order=sideways"));
    expect(grid.status).toBe(400);
    expect(await grid.json()).toEqual({ ok: false, error: "invalid_order" });
    expect(getList).not.toHaveBeenCalled();
  });

  it("flows a valid order end-to-end: the real curator returns the library oldest-first", async () => {
    const actual = await vi.importActual<typeof import("@/lib/photos/curate")>("@/lib/photos/curate");
    mocks.curate.mockImplementation((photos: unknown[], options: unknown) =>
      actual.curateWallPhotos(
        photos as Parameters<typeof actual.curateWallPhotos>[0],
        options as Parameters<typeof actual.curateWallPhotos>[1],
      ),
    );
    // The fake PB serves pages as given (it ignores `sort`), so the chronological
    // ordering below comes purely from the `order` that reached the curator —
    // proving the param threads route → curate, not just that PB was asked.
    feedPb([
      [
        row("new", "2026-06-01T00:00:00.000Z"),
        row("old", "2024-02-01T00:00:00.000Z"),
        row("mid", "2025-03-01T00:00:00.000Z"),
        row("future", "2027-08-01T00:00:00.000Z"),
      ],
    ]);

    const res = await GET(getReq("?order=oldest&limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos.map((p: { id: string }) => p.id)).toEqual(["old", "mid", "new"]);
  });

  it("503s honestly when PocketBase is down, and says so once on the console", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withAdmin.mockImplementation(async () => {
      throw new Error("boom");
    });

    const res = await GET(getReq(""));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "photos_unreachable" });
    expect(err).toHaveBeenCalledWith("[photos]", "boom");
  });
});

describe("GET — all=1 (management grid)", () => {
  it("skips curation entirely and returns every row newest-first", async () => {
    const { getList } = feedPb([
      [
        row("old", "2026-01-01T00:00:00.000Z"),
        row("new", "2026-06-01T00:00:00.000Z", { showOnWall: false }),
        row("mid", "2026-03-01T00:00:00.000Z"),
      ],
    ]);

    const res = await GET(getReq("?all=1"));
    expect(res.status).toBe(200);
    // The curator would have shuffled these; it must not be consulted at all.
    expect(mocks.curate).not.toHaveBeenCalled();
    expect(getList).toHaveBeenCalledWith(1, 60, { sort: "-takenAt" });

    const body = await res.json();
    expect(body.photos.map((p: { id: string }) => p.id)).toEqual(["new", "mid", "old"]);
    // Hidden rows are the whole point of the Photos page.
    expect(body.photos[0].showOnWall).toBe(false);
  });
});

describe("PATCH — live-identity gate", () => {
  it.each([
    [401, "unauthorized"],
    [403, "adult_only"],
    [503, "member_lookup_failed"],
  ])("passes %i through with %s when the live check fails", async (status, reason) => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status, reason });

    const res = await PATCH(patchReq({ id: VALID_ID, showOnWall: false }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error: reason });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("404s an unknown id as not_found instead of a generic 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withAdmin.mockImplementation(async () => {
      const err = new Error("Failed to update record.") as Error & {
        status?: number;
        data?: { code?: number };
      };
      err.status = 404;
      err.data = { code: 404 };
      throw err;
    });

    const res = await PATCH(patchReq({ id: VALID_ID, showOnWall: false }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("flips showOnWall for a live parent", async () => {
    const { update } = feedPb([[]]);

    const res = await PATCH(patchReq({ id: VALID_ID, showOnWall: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(VALID_ID, { showOnWall: false });
    expect(mocks.verifyLiveParentSession).toHaveBeenCalledTimes(1);
  });

  it("502s an unexpected write failure and logs the message only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withAdmin.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    const res = await PATCH(patchReq({ id: VALID_ID, showOnWall: true }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "update_failed" });
    expect(err).toHaveBeenCalledWith("[photos]", "connection reset");
  });
});

describe("CurateOptions.order (added for spec §3.7; behaviour untouched)", () => {
  it("keeps shuffle byte-for-byte identical whether or not the option is passed", async () => {
    const actual = await vi.importActual<typeof import("@/lib/photos/curate")>("@/lib/photos/curate");
    const photos = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      url: `/api/photos/file?r=p${i}`,
      width: 100,
      height: 100,
      takenAt: `2026-0${(i % 9) + 1}-15T12:00:00.000Z`,
    }));
    const opts = { dateKey: "2026-9-30", limit: 8 };

    const baseline = actual.curateWallPhotos(photos, opts).map((p) => p.id);
    const explicit = actual.curateWallPhotos(photos, { ...opts, order: "shuffle" }).map((p) => p.id);
    const absent = actual.curateWallPhotos(photos, { ...opts, order: undefined }).map((p) => p.id);

    expect(explicit).toEqual(baseline);
    expect(absent).toEqual(baseline);
    expect(baseline).toHaveLength(8);
  });
});
