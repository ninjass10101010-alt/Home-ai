// GET/PATCH /api/photos/settings — spec §2 (the settings route; §3's hook is a
// different task). Three seams are mocked exactly the way
// tests/unit/photos-feed-route.test.ts mocks the feed route: `withAdmin`
// (PocketBase), `@/lib/session` (GET's in-route check) and
// `verifyLiveParentSession` (PATCH's live-identity gate). Assertions are on
// status codes, error keys, and what the route asks PocketBase to write.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifySession: vi.fn(),
  verifyLiveParentSession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: (token?: string) => mocks.verifySession(token),
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: (request: unknown) => mocks.verifyLiveParentSession(request),
}));

import { GET, PATCH } from "@/app/api/photos/settings/route";
import { PHOTO_SETTINGS_DEFAULTS } from "@/lib/photos/settings";

const URL = "http://localhost/api/photos/settings";

// Session-cookie convention for this suite: "role|full name|memberId"
// (tests/unit/celebrate-win-route.test.ts).
const MEMBER_COOKIE = "parent|Rebecca Garcia|m-reb";

type Row = Record<string, unknown>;

const PB_MISSING_ROW = Object.assign(new Error("Failed to find record."), {
  status: 404,
  data: { code: 404 },
});

// PocketBase answers a MISSING COLLECTION with 404 too — that is a read
// failure (degraded), not "nobody has saved yet".
const PB_MISSING_COLLECTION = Object.assign(new Error("Missing or invalid collection name."), {
  status: 404,
  data: { code: 404 },
});

function getReq(cookie?: string): NextRequest {
  return new NextRequest(URL, {
    method: "GET",
    headers: cookie ? { cookie: `consuela_session=${cookie}` } : {},
  });
}

function patchReq(body: unknown, cookie: string | undefined = MEMBER_COOKIE): NextRequest {
  return new NextRequest(URL, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie: `consuela_session=${cookie}` }),
    },
    // A raw string is sent verbatim so malformed JSON can be tested.
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Fake PB serving `photo_settings` with canned getFirstListItem/create/update. */
function settingsPb(opts: {
  row?: Row | null;
  getError?: unknown;
  createError?: unknown;
  updateError?: unknown;
  raceRow?: Row;
}) {
  const { row = null, getError, createError, updateError, raceRow } = opts;
  const getFirstListItem = vi.fn(async () => {
    if (getError) throw getError;
    if (row) return row;
    throw PB_MISSING_ROW;
  });
  const create = vi.fn(async (payload: Row) => {
    if (createError) throw createError;
    return { id: "new-row", ...payload };
  });
  const update = vi.fn(async (_id: string, payload: Row) => {
    if (updateError) throw updateError;
    return payload;
  });

  let getCalls = 0;
  if (raceRow) {
    // Create-race fixture: the row does not exist yet, the create loses to a
    // concurrent writer, and the re-lookup finds it.
    getFirstListItem.mockImplementation(async () => {
      getCalls += 1;
      if (getCalls === 1) throw PB_MISSING_ROW;
      return raceRow;
    });
  }

  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: (name: string) => {
        if (name !== "photo_settings") throw new Error(`unexpected collection: ${name}`);
        return { getFirstListItem, create, update };
      },
    }),
  );
  return { getFirstListItem, create, update };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifySession.mockReset();
  mocks.verifySession.mockImplementation(async (token?: string) => {
    if (typeof token !== "string" || !token.includes("|")) return null;
    const [role, name, memberId] = token.split("|");
    return { role, name, memberId, exp: 9_999_999_999 };
  });
  mocks.verifyLiveParentSession.mockReset();
  mocks.verifyLiveParentSession.mockResolvedValue({
    ok: true,
    member: { id: "m-reb", name: "Rebecca Garcia", role: "parent" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET — any signed-in family member", () => {
  it("401s without a session and never touches PocketBase", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("401s on a garbage cookie too", async () => {
    mocks.verifySession.mockResolvedValueOnce(null);
    const res = await GET(getReq("nonsense"));
    expect(res.status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("returns the normalized row when one exists", async () => {
    settingsPb({
      row: { id: "r1", key: "wall", rotateSeconds: 300, transition: "slide", order: "oldest", showCaption: false },
    });

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: { rotateSeconds: 300, transition: "slide", order: "oldest", showCaption: false },
    });
  });

  it("normalizes a hand-edited bad row instead of serving it raw", async () => {
    settingsPb({
      row: { id: "r1", key: "wall", rotateSeconds: 9999, transition: "warp", order: 7, showCaption: "false" },
    });

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: { rotateSeconds: 600, transition: "crossfade", order: "shuffle", showCaption: true },
    });
  });

  it("returns defaults 200 (no degraded flag) when no row exists yet", async () => {
    settingsPb({});

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, settings: PHOTO_SETTINGS_DEFAULTS });
    expect(body.degraded).toBeUndefined();
  });

  it("degrades to defaults 200 + degraded:true when PocketBase is down", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsPb({ getError: new Error("connection refused") });

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: PHOTO_SETTINGS_DEFAULTS,
      degraded: true,
    });
    expect(err).toHaveBeenCalledWith("[photos:settings]", "connection refused");
  });

  it("treats a missing COLLECTION as a degraded read, not as 'never saved'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    settingsPb({ getError: PB_MISSING_COLLECTION });

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: PHOTO_SETTINGS_DEFAULTS,
      degraded: true,
    });
  });

  it("never 5xxes on a read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.withAdmin.mockImplementation(async () => {
      throw new Error("PB exploded");
    });

    const res = await GET(getReq(MEMBER_COOKIE));
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual(PHOTO_SETTINGS_DEFAULTS);
  });
});

describe("PATCH — parent only, live identity", () => {
  it.each([
    [401, "unauthorized"],
    [403, "adult_only"],
    [503, "member_lookup_failed"],
  ])("passes %i through with %s when the live check fails", async (status, reason) => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status, reason });

    const res = await PATCH(patchReq({ rotateSeconds: 30 }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error: reason });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("gates BEFORE parsing the body", async () => {
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 403, reason: "adult_only" });

    const res = await PATCH(patchReq("{not json"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "adult_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("400s an unparseable body as invalid_body", async () => {
    const res = await PATCH(patchReq("{oops"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("400s a non-object body as invalid_body", async () => {
    const res = await PATCH(patchReq("[1,2]"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it.each([
    [{ rotateSeconds: "75" }, "invalid_rotate_seconds"],
    [{ rotateSeconds: null }, "invalid_rotate_seconds"],
    [{ rotateSeconds: Number.NaN }, "invalid_rotate_seconds"],
    [{ transition: "wiggle" }, "invalid_transition"],
    [{ transition: 12 }, "invalid_transition"],
    [{ order: "random" }, "invalid_order"],
    [{ order: null }, "invalid_order"],
    [{ showCaption: "true" }, "invalid_show_caption"],
    [{ showCaption: 1 }, "invalid_show_caption"],
  ])("400s %o as %s without touching PocketBase", async (body, error) => {
    const res = await PATCH(patchReq(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("clamps rotateSeconds on write (5 → 10)", async () => {
    const { update } = settingsPb({ row: { id: "r1", key: "wall" } });

    const res = await PATCH(patchReq({ rotateSeconds: 5 }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith("r1", expect.objectContaining({ rotateSeconds: 10 }));
    expect((await res.json()).settings.rotateSeconds).toBe(10);
  });

  it("clamps rotateSeconds on write (9999 → 600)", async () => {
    const { update } = settingsPb({ row: { id: "r1", key: "wall" } });

    const res = await PATCH(patchReq({ rotateSeconds: 9999 }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith("r1", expect.objectContaining({ rotateSeconds: 600 }));
  });

  it("creates the singleton when no row exists (never a second row later)", async () => {
    const { create, update } = settingsPb({});

    const res = await PATCH(patchReq({ transition: "dissolve" }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      key: "wall",
      rotateSeconds: 75,
      transition: "dissolve",
      order: "shuffle",
      showCaption: true,
    });
    expect(update).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      ok: true,
      settings: { rotateSeconds: 75, transition: "dissolve", order: "shuffle", showCaption: true },
    });
  });

  it("updates the existing row instead of creating a second one", async () => {
    const { create, update } = settingsPb({ row: { id: "r1", key: "wall" } });

    const res = await PATCH(patchReq({ order: "oldest" }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("r1", {
      rotateSeconds: 75,
      transition: "crossfade",
      order: "oldest",
      showCaption: true,
    });
    expect(await res.json()).toEqual({
      ok: true,
      settings: { rotateSeconds: 75, transition: "crossfade", order: "oldest", showCaption: true },
    });
  });

  it("recovers from a create race by re-reading and updating (single row)", async () => {
    const race = Object.assign(new Error("UNIQUE constraint failed: photo_settings.key"), {
      status: 400,
      data: { message: "Failed to create record." },
    });
    const { create, update, getFirstListItem } = settingsPb({
      createError: race,
      raceRow: { id: "r2", key: "wall", rotateSeconds: 45 },
    });

    const res = await PATCH(patchReq({ showCaption: false }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getFirstListItem).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    // The winner's stored value survives — the racing write merges ONTO it
    // instead of overwriting it with defaults.
    expect(update).toHaveBeenCalledWith("r2", { rotateSeconds: 45, transition: "crossfade", order: "shuffle", showCaption: false });
    const body = await res.json();
    expect(body.settings).toEqual({
      rotateSeconds: 45,
      transition: "crossfade",
      order: "shuffle",
      showCaption: false,
    });
  });

  it("returns server truth: the subset merges with what is stored", async () => {
    settingsPb({ row: { id: "r1", key: "wall", rotateSeconds: 30, order: "newest", showCaption: false } });

    const res = await PATCH(patchReq({ rotateSeconds: 5, transition: "dissolve" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      settings: { rotateSeconds: 10, transition: "dissolve", order: "newest", showCaption: false },
    });
  });

  it("503s a write failure as settings_unreachable and logs the message only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsPb({ createError: new Error("connection reset") });

    const res = await PATCH(patchReq({ rotateSeconds: 30 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "settings_unreachable" });
    expect(err).toHaveBeenCalledWith("[photos:settings]", "connection reset");
  });

  it("503s when the lookup itself fails (collection missing / PB down)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    settingsPb({ getError: new Error("Missing or invalid collection name.") });

    const res = await PATCH(patchReq({ rotateSeconds: 30 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "settings_unreachable" });
  });

  it("503s a failed update too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    settingsPb({ row: { id: "r1", key: "wall" }, updateError: new Error("PB gone") });

    const res = await PATCH(patchReq({ showCaption: false }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "settings_unreachable" });
  });
});
