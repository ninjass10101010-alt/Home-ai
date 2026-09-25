import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class GoogleAuthError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  function mapGoogleAuthError(error: unknown) {
    if (error instanceof GoogleAuthError) {
      return {
        status: error.code === "unavailable" ? 503 : error.code === "no_grant" ? 409 : 401,
        body: { ok: false as const, code: error.code, error: error.message },
      };
    }
    return {
      status: 500,
      body: {
        ok: false as const,
        code: "unknown",
        error: error instanceof Error ? error.message : "Unknown Google auth error",
      },
    };
  }
  return {
  authorizeAdminRequest: vi.fn(),
  isDeviceAttemptActive: vi.fn(),
  withDeviceAttemptCommit: vi.fn(),
  pollForToken: vi.fn(),
    fetchAccountEmail: vi.fn(),
    saveTokens: vi.fn(),
    isGoogleConnected: vi.fn(),
    GoogleAuthError,
    mapGoogleAuthError,
    syncCalendar: vi.fn(),
    listCalendars: vi.fn(),
    ensureGoogleCollections: vi.fn(),
    getStoredTokens: vi.fn(),
    getStoredTokensStrict: vi.fn(),
    syncTasks: vi.fn(),
  };
});

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/google/device-auth", () => ({
  pollForToken: mocks.pollForToken,
  fetchAccountEmail: mocks.fetchAccountEmail,
}));
vi.mock("@/lib/google/device-attempts", () => ({
  isDeviceAttemptActive: mocks.isDeviceAttemptActive,
  withDeviceAttemptCommit: mocks.withDeviceAttemptCommit,
}));
vi.mock("@/lib/google/token-store", () => ({ saveTokens: mocks.saveTokens, getStoredTokens: mocks.getStoredTokens, getStoredTokensStrict: mocks.getStoredTokensStrict }));
vi.mock("@/lib/google/oauth-client", () => ({
    isGoogleConnected: mocks.isGoogleConnected,
    GoogleAuthError: mocks.GoogleAuthError,
    mapGoogleAuthError: mocks.mapGoogleAuthError,
  }));
vi.mock("@/lib/google/calendar", () => ({ syncCalendar: mocks.syncCalendar, listCalendars: mocks.listCalendars }));
vi.mock("@/lib/google/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google/tasks")>()),
  syncTasks: mocks.syncTasks,
}));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));

import { POST as poll } from "@/app/api/google/device-poll/route";
import { POST as sync } from "@/app/api/google/sync/route";
import { GET as getTasks, POST as postTasks } from "@/app/api/google-tasks/route";

function request(path: string, body: unknown = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const [key, mock] of Object.entries(mocks)) {
    if (key !== "GoogleAuthError" && key !== "mapGoogleAuthError") (mock as any).mockReset();
  }
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.isDeviceAttemptActive.mockResolvedValue(true);
  mocks.withDeviceAttemptCommit.mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn());
  mocks.pollForToken.mockResolvedValue({ status: "pending", error: "authorization_pending", interval: 5 });
  mocks.fetchAccountEmail.mockResolvedValue("family@example.com");
  mocks.saveTokens.mockResolvedValue(undefined);
  mocks.isGoogleConnected.mockResolvedValue(true);
  mocks.syncCalendar.mockResolvedValue({ events: 2, deleted: 0, perCalendar: [] });
  mocks.listCalendars.mockResolvedValue([]);
  mocks.ensureGoogleCollections.mockResolvedValue(undefined);
  mocks.getStoredTokens.mockResolvedValue({ scope: "calendar" });
  mocks.getStoredTokensStrict.mockResolvedValue({ scope: "calendar" });
  mocks.syncTasks.mockResolvedValue({ tasks: 1, deleted: 0 });
});

describe("Google mutating route authorization", () => {
  it.each(["child", "pet"])("rejects a %s session before polling for a token", async (role) => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const result = await poll(request("/api/google/device-poll", { attempt_id: "attempt-1", device_code: "device" }));

    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.pollForToken).not.toHaveBeenCalled();
    expect(role).toBeTruthy();
  });

  it("blocks a child Google Tasks POST before connection or PB work", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const result = await postTasks(request("/api/google-tasks", { action: "create", title: "Nope" }));

    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.isGoogleConnected).not.toHaveBeenCalled();
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
  });

  it("blocks a child Google Tasks sync GET before collection setup", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const result = await getTasks(new NextRequest("http://localhost/api/google-tasks?sync=now"));

    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
    expect(mocks.isGoogleConnected).not.toHaveBeenCalled();
  });

  it("allows a parent session to poll a pending token", async () => {
    const result = await poll(request("/api/google/device-poll", { attempt_id: "attempt-1", device_code: "device" }));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "pending" });
    expect(mocks.pollForToken).toHaveBeenCalledWith("device", 5);
  });

  it.each(["child", "pet"])("rejects a %s session before starting a sync", async (role) => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const result = await sync(request("/api/google/sync", { resource: "calendar" }));

    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.isGoogleConnected).not.toHaveBeenCalled();
    expect(role).toBeTruthy();
  });

  it.each([
    ["null", null, "invalid_body"],
    ["array", [], "invalid_body"],
    ["number", 42, "invalid_body"],
    ["string", "calendar", "invalid_body"],
    ["unknown resource", { resource: "unknown" }, "invalid_resource"],
  ])("rejects a %s sync body before connection work", async (_label, body, error) => {
    const result = await sync(request("/api/google/sync", body));

    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ ok: false, error });
    expect(mocks.isGoogleConnected).not.toHaveBeenCalled();
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
  });

  it("reports top-level partial failure when a selected calendar fails", async () => {
    mocks.syncCalendar.mockResolvedValue({
      events: 1,
      deleted: 0,
      perCalendar: [{ calendarId: "family", ok: false, error: "calendar unavailable" }],
    });

    const result = await sync(request("/api/google/sync", { resource: "calendar" }));
    const body = await result.json();

    expect(result.status).toBe(502);
    expect(body).toMatchObject({ ok: false, partial: true, error: "calendar_partial_failure" });
    expect(body.calendar.perCalendar[0]).toMatchObject({ ok: false });
  });

  it.each([
    ["skipped calendar", { syncCalendar: { skipped: true, reason: "already_in_progress" }, status: 409, error: "calendar_sync_skipped", skipped: true }],
    ["missing Tasks scope", { scope: "calendar", status: 409, error: "tasks_scope_missing", skipped: true }],
    ["Tasks sync error", { scope: "googleapis.com/auth/tasks", tasksError: true, status: 502, error: "tasks_sync_failed", partial: true }],
  ])("returns a top-level failure for %s", async (_label, options: {
    syncCalendar?: { skipped: boolean; reason: string };
    scope?: string;
    tasksError?: boolean;
    status: number;
    error: string;
    skipped?: boolean;
    partial?: boolean;
  }) => {
    if (options.syncCalendar) mocks.syncCalendar.mockResolvedValueOnce(options.syncCalendar);
    mocks.getStoredTokensStrict.mockResolvedValueOnce({ scope: options.scope || "calendar" });
    if (options.tasksError) mocks.syncTasks.mockRejectedValueOnce(new Error("tasks failed"));

    const result = await sync(request("/api/google/sync", { resource: "all" }));
    const body = await result.json();

    expect(result.status).toBe(options.status);
    expect(body).toMatchObject({ ok: false, error: options.error, ...(options.skipped ? { skipped: true } : {}), ...(options.partial ? { partial: true } : {}) });
  });

  it("allows a parent session to sync the requested resource", async () => {
    const result = await sync(request("/api/google/sync", { resource: "calendar" }));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ ok: true, calendar: { events: 2, perCalendar: [] } });
    expect(mocks.syncCalendar).toHaveBeenCalledTimes(1);
  });

  it("returns an unavailable sync response instead of no_grant when token state cannot be read", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(new mocks.GoogleAuthError("unavailable", "PB unavailable"));

    const result = await sync(request("/api/google/sync", { resource: "calendar" }));
    const body = await result.json();

    expect(result.status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "unavailable", error: "PB unavailable" });
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
  });

  it("keeps a genuinely absent grant as no_grant", async () => {
    mocks.isGoogleConnected.mockResolvedValueOnce(false);

    const result = await sync(request("/api/google/sync", { resource: "calendar" }));
    const body = await result.json();

    expect(result.status).toBe(409);
    expect(body).toMatchObject({ ok: false, code: "no_grant" });
  });

  it("returns unavailable when a post-connect token read fails", async () => {
    mocks.isGoogleConnected.mockResolvedValueOnce(true);
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    const result = await sync(request("/api/google/sync", { resource: "calendar" }));
    const body = await result.json();

    expect(result.status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "unavailable" });
  });

});
