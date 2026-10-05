import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isGoogleConnected: vi.fn(),
  readConnectionSnapshot: vi.fn(),
  authorizeAdminRequest: vi.fn(),
  authorizeCurrentParentRequest: vi.fn(),
  getStoredTokensStrict: vi.fn(),
  readCalendarSyncRows: vi.fn(),
  readCachedEvents: vi.fn(),
  readCachedReminders: vi.fn(),
  readCachedTasks: vi.fn(),
  syncCalendar: vi.fn(),
  syncTasks: vi.fn(),
  listCalendars: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  checkQuota: vi.fn(),
  isCronAuthorized: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  createReminder: vi.fn(),
  getConsuelaListId: vi.fn(),
}));

vi.mock("@/lib/google/token-store", () => ({
  getStoredTokensStrict: mocks.getStoredTokensStrict,
}));
vi.mock("@/lib/google/device-auth", () => ({
  refreshAccessToken: vi.fn(),
  revokeGoogleToken: vi.fn(),
}));
vi.mock("@/lib/google/api-quota", () => ({
  recordApiCall: vi.fn(),
}));
vi.mock("@/lib/google/oauth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/oauth-client")>();
  return { ...actual, isGoogleConnected: mocks.isGoogleConnected };
});
vi.mock("@/lib/google/connection-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/connection-state")>();
  return {
    ...actual,
    isGoogleConnected: mocks.isGoogleConnected,
    readConnectionSnapshot: mocks.readConnectionSnapshot,
  };
});
vi.mock("@/lib/google/calendar", () => ({
  readCalendarSyncRows: mocks.readCalendarSyncRows,
  readCachedEvents: mocks.readCachedEvents,
  syncCalendar: mocks.syncCalendar,
  listCalendars: mocks.listCalendars,
  setCalendarSelection: vi.fn(),
  pruneCalendar: vi.fn(),
}));
vi.mock("@/lib/google/tasks", () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  deleteTask: mocks.deleteTask,
  completeTask: mocks.completeTask,
  uncompleteTask: mocks.uncompleteTask,
  createReminder: mocks.createReminder,
  getConsuelaListId: mocks.getConsuelaListId,
  readCachedTasks: mocks.readCachedTasks,
  readCachedReminders: mocks.readCachedReminders,
  syncTasks: mocks.syncTasks,
}));
vi.mock("@/lib/google/pb-collections", () => ({
  ensureGoogleCollections: mocks.ensureGoogleCollections,
}));
vi.mock("@/lib/google/quota-guard", () => ({
  checkQuota: mocks.checkQuota,
}));
vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: mocks.isCronAuthorized,
}));
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminRequest: mocks.authorizeAdminRequest,
}));
vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));

import { GoogleAuthError } from "@/lib/google/oauth-client";
import { GoogleAuthError as ConnectionGoogleAuthError } from "@/lib/google/connection-state";
import { GET as getCalendar } from "@/app/api/google-calendar/route";
import { GET as getCalendars } from "@/app/api/google/calendars/route";
import { GET as getTasks, POST as postTasks } from "@/app/api/google-tasks/route";
import { POST as postCronSync } from "@/app/api/cron/consuela/google-sync/route";

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.isGoogleConnected.mockResolvedValue(true);
  mocks.readConnectionSnapshot.mockResolvedValue({
    connectedAccountId: null,
    status: null,
    accountEmail: null,
    connectedAt: null,
    lastVerifiedAt: null,
  });
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "m1", role: "parent" } });
  mocks.getStoredTokensStrict.mockResolvedValue({
    scope: "googleapis.com/auth/tasks",
    account_email: "family@example.com",
    granted_at: "2026-09-24T00:00:00.000Z",
  });
  mocks.readCalendarSyncRows.mockResolvedValue([]);
  mocks.readCachedEvents.mockResolvedValue([]);
  mocks.readCachedReminders.mockResolvedValue([]);
  mocks.readCachedTasks.mockResolvedValue([]);
  mocks.syncCalendar.mockResolvedValue({ events: 1, deleted: 0, perCalendar: [] });
  mocks.syncTasks.mockResolvedValue({ tasks: 1, deleted: 0 });
  mocks.listCalendars.mockResolvedValue([]);
  mocks.ensureGoogleCollections.mockResolvedValue(undefined);
  mocks.checkQuota.mockResolvedValue({ ok: true, remaining: 100 });
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.createTask.mockResolvedValue({ id: "task-1" });
});

describe("GET /api/google-calendar auth errors", () => {
  it("blocks a non-parent sync request before collection setup", async () => {
    mocks.authorizeAdminRequest.mockResolvedValueOnce({ ok: false, status: 403, error: "adult_only" });

    const response = await getCalendar(new NextRequest("http://localhost/api/google-calendar?sync=now"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: "adult_only" });
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
  });

  it("reports partial calendar sync instead of claiming success", async () => {
    mocks.syncCalendar.mockResolvedValueOnce({
      events: 1,
      deleted: 0,
      perCalendar: [{ calendarId: "family", ok: false, error: "calendar unavailable" }],
    });

    const response = await getCalendar(new NextRequest("http://localhost/api/google-calendar?sync=now"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ ok: false, partial: true, stale: true, error: "calendar_partial_failure" });
  });

  it("returns unavailable when auth state cannot be read", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new ConnectionGoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await getCalendar(request("/api/google-calendar"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });

  it("reports a missing connection snapshot as disconnected, never as Composio", async () => {
    mocks.isGoogleConnected.mockResolvedValue(false);
    mocks.readCachedEvents.mockResolvedValueOnce([{ google_id: "cached", summary: "Cached event" }]);

    const response = await getCalendar(request("/api/google-calendar"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, connected: false, source: "none", stale: true, events: [] });
    expect(body.source).not.toBe("composio");
  });

  it("keeps no_grant as a successful disconnected response", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new ConnectionGoogleAuthError("no_grant", "Google account is not connected"),
    );

    const response = await getCalendar(request("/api/google-calendar"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connected: false, stale: true });
  });

  it("reports an ACTIVE Composio snapshot as google-sourced with provider composio", async () => {
    mocks.readConnectionSnapshot.mockResolvedValueOnce({
      connectedAccountId: "composio-account-1",
      status: "ACTIVE",
      accountEmail: "family@example.com",
      connectedAt: "2026-09-24T00:00:00.000Z",
      lastVerifiedAt: "2026-09-24T00:00:00.000Z",
    });
    mocks.readCalendarSyncRows.mockResolvedValueOnce([
      {
        id: "r1",
        calendar_id: "primary",
        summary: "Primary",
        color_rgb: "#111111",
        selected: true,
        sync_token: null,
        last_sync_at: "2026-09-24T10:00:00.000Z",
        last_status: "ok",
        last_error: null,
      },
      {
        id: "r2",
        calendar_id: "school",
        summary: "School",
        color_rgb: null,
        selected: true,
        sync_token: null,
        last_sync_at: "2026-09-25T10:00:00.000Z",
        last_status: "ok",
        last_error: null,
      },
    ]);

    const response = await getCalendar(request("/api/google-calendar"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      source: "google",
      provider: "composio",
      account_email: "family@example.com",
      last_sync_at: "2026-09-25T10:00:00.000Z",
      calendar_colors: { primary: "#111111" },
    });
    expect(body.source).not.toBe("composio");
  });

  it.each([
    ["child", 403, "adult_only"],
    ["deleted", 401, "unauthorized"],
    ["outage", 503, "identity_unavailable"],
  ])("blocks %s plain Google Tasks GET before collection or cache reads", async (_label, status, error) => {
    mocks.authorizeAdminRequest.mockResolvedValueOnce({ ok: false, status, error });

    const response = await getTasks(request("/api/google-tasks"));

    expect(response.status).toBe(status);
    expect(mocks.ensureGoogleCollections).not.toHaveBeenCalled();
    expect(mocks.readCachedTasks).not.toHaveBeenCalled();
    expect(mocks.readCachedReminders).not.toHaveBeenCalled();
  });

  it("returns unavailable when the connection snapshot read fails", async () => {
    mocks.readConnectionSnapshot.mockRejectedValueOnce(new Error("PB unavailable"));

    const response = await getCalendar(request("/api/google-calendar"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "Google connection state unavailable",
    });
  });
});

describe("GET /api/google/calendars auth errors", () => {
  it("returns unavailable when auth state cannot be read", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await getCalendars(request("/api/google/calendars"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });

  it("keeps no_grant as a successful disconnected response", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("no_grant", "Google account is not connected"),
    );

    const response = await getCalendars(request("/api/google/calendars"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connected: false });
  });

  it("maps a calendar-list auth failure", async () => {
    mocks.listCalendars.mockRejectedValueOnce(
      new GoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await getCalendars(request("/api/google/calendars"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });
});

describe("GET /api/google-tasks auth errors", () => {
  it("returns unavailable when auth state cannot be read", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await getTasks(request("/api/google-tasks"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });

  it("keeps no_grant as a successful disconnected response", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("no_grant", "Google account is not connected"),
    );

    const response = await getTasks(request("/api/google-tasks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      connected: false,
      tasks: [],
      reminders: [],
    });
  });

  it("keeps a strict no-grant metadata read as a successful disconnected response", async () => {
    mocks.getStoredTokensStrict.mockResolvedValueOnce(null);

    const response = await getTasks(request("/api/google-tasks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      connected: false,
      tasks: [],
      reminders: [],
    });
  });

  it("returns unavailable when the strict scope read fails", async () => {
    mocks.getStoredTokensStrict.mockRejectedValueOnce(new Error("PB unavailable"));

    const response = await getTasks(request("/api/google-tasks"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "Google token state unavailable",
    });
  });
});

describe("POST /api/google-tasks auth errors", () => {
  it("returns no_grant as 409", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("no_grant", "Google account is not connected"),
    );

    const response = await postTasks(
      request("/api/google-tasks", { action: "create", title: "Test" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "no_grant",
      error: "Google account is not connected",
    });
  });

  it("returns unavailable as 503", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new GoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await postTasks(
      request("/api/google-tasks", { action: "create", title: "Test" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });

  it("maps other action auth errors to 401", async () => {
    mocks.createTask.mockRejectedValueOnce(
      new GoogleAuthError("revoked", "Reconnect required"),
    );

    const response = await postTasks(
      request("/api/google-tasks", { action: "create", title: "Test" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      code: "revoked",
      error: "Reconnect required",
    });
  });
});

describe("POST /api/cron/consuela/google-sync auth errors", () => {
  it("reports a partial cron sync when a selected calendar fails", async () => {
    mocks.syncCalendar.mockResolvedValueOnce({
      events: 1,
      deleted: 0,
      perCalendar: [{ calendarId: "family", ok: false, error: "calendar unavailable" }],
    });

    const response = await postCronSync(request("/api/cron/consuela/google-sync"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ ok: false, partial: true, error: "calendar_partial_failure" });
  });

  it("returns no_grant as 409", async () => {
    mocks.isGoogleConnected.mockRejectedValueOnce(
      new ConnectionGoogleAuthError("no_grant", "Google account is not connected"),
    );

    const response = await postCronSync(request("/api/cron/consuela/google-sync"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "no_grant",
      error: "Google account is not connected",
    });
  });

  it("returns unavailable as 503", async () => {
    mocks.syncCalendar.mockRejectedValueOnce(
      new ConnectionGoogleAuthError("unavailable", "PB unavailable"),
    );

    const response = await postCronSync(request("/api/cron/consuela/google-sync"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unavailable",
      error: "PB unavailable",
    });
  });

  it("maps unknown sync failures to 500", async () => {
    mocks.syncCalendar.mockRejectedValueOnce(new Error("Sync exploded"));

    const response = await postCronSync(request("/api/cron/consuela/google-sync"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      code: "unknown",
      error: "Sync exploded",
    });
  });
});
