import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  syncCalendar: vi.fn(),
  syncTasks: vi.fn(),
  checkQuota: vi.fn(),
  isGoogleConnected: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  isCronAuthorized: vi.fn(),
  retryPendingCalendarMirrors: vi.fn(),
}));

vi.mock("@/lib/google/calendar", () => ({ syncCalendar: mocks.syncCalendar }));
vi.mock("@/lib/google/tasks", () => ({ syncTasks: mocks.syncTasks }));
vi.mock("@/lib/google/quota-guard", () => ({ checkQuota: mocks.checkQuota }));
vi.mock("@/lib/google/connection-state", () => ({
  isGoogleConnected: mocks.isGoogleConnected,
  mapGoogleAuthError: vi.fn(),
}));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));
vi.mock("@/lib/calendar/event-service", () => ({
  retryPendingCalendarMirrors: mocks.retryPendingCalendarMirrors,
}));

import { POST } from "@/app/api/cron/consuela/google-sync/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.isGoogleConnected.mockResolvedValue(true);
  mocks.ensureGoogleCollections.mockResolvedValue(undefined);
  mocks.checkQuota.mockResolvedValue({ ok: true });
  mocks.syncCalendar.mockResolvedValue({ perCalendar: [] });
  mocks.syncTasks.mockResolvedValue({ ok: true });
});

describe("POST /api/cron/consuela/google-sync", () => {
  it("retries pending calendar mirrors after a successful sync", async () => {
    mocks.retryPendingCalendarMirrors.mockResolvedValue({ checked: 2, synced: 1, failed: 1 });
    const res = await POST(new NextRequest("http://localhost/api/cron/consuela/google-sync"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.retryPendingCalendarMirrors).toHaveBeenCalledWith(20);
    expect(body.mirrors).toEqual({ checked: 2, synced: 1, failed: 1 });
  });

  it("survives a mirror-retry failure without failing the sync", async () => {
    mocks.retryPendingCalendarMirrors.mockRejectedValue(new Error("pb down"));
    const res = await POST(new NextRequest("http://localhost/api/cron/consuela/google-sync"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mirrors).toEqual({ checked: 0, synced: 0, failed: 0 });
  });

  it("does not retry mirrors when Google is not connected", async () => {
    mocks.isGoogleConnected.mockResolvedValue(false);
    const res = await POST(new NextRequest("http://localhost/api/cron/consuela/google-sync"));
    expect(res.status).toBe(409);
    expect(mocks.retryPendingCalendarMirrors).not.toHaveBeenCalled();
  });
});
