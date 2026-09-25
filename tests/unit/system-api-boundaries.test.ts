import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeCurrentParentRequest: vi.fn(),
  authorizeAdminRequest: vi.fn(),
  verifySession: vi.fn(),
  readPublicState: vi.fn(),
  readCalendarSyncRows: vi.fn(),
  withAdmin: vi.fn(),
  isGoogleConnected: vi.fn(),
  listCalendars: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  listAiProviders: vi.fn(),
  resolveChatTargets: vi.fn(),
  fetchHADeviceStates: vi.fn(),
  listHANotifyTargets: vi.fn(),
  runServiceTest: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ authorizeCurrentParentRequest: mocks.authorizeCurrentParentRequest }));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/session", () => ({ verifySession: mocks.verifySession, SESSION_COOKIE: "consuela_session" }));
vi.mock("@/lib/google/token-store", () => ({ readPublicState: mocks.readPublicState }));
vi.mock("@/lib/google/calendar", () => ({
  readCalendarSyncRows: mocks.readCalendarSyncRows,
  listCalendars: mocks.listCalendars,
}));
vi.mock("@/lib/google/oauth-client", () => ({
  isGoogleConnected: mocks.isGoogleConnected,
  GoogleAuthError: class GoogleAuthError extends Error {},
  mapGoogleAuthError: vi.fn(() => ({ status: 500, body: { error: "unavailable" } })),
}));
vi.mock("@/lib/google/pb-collections", () => ({ ensureGoogleCollections: mocks.ensureGoogleCollections }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/ai/providers", () => ({
  listAiProviders: mocks.listAiProviders,
  upsertAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(),
}));
vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsCache: vi.fn(),
}));
vi.mock("@/lib/ha/rest-client", () => ({ fetchHADeviceStates: mocks.fetchHADeviceStates }));
vi.mock("@/lib/ha/notify", () => ({ listHANotifyTargets: mocks.listHANotifyTargets }));
vi.mock("@/lib/services/tests", () => ({ runServiceTest: mocks.runServiceTest }));

import { GET as googleStateGET } from "@/app/api/google/state/route";
import { GET as googleSyncStateGET } from "@/app/api/google/sync-state/route";
import { GET as googleCalendarsGET } from "@/app/api/google/calendars/route";
import { GET as aiProvidersGET } from "@/app/api/ai/providers/route";
import { GET as haNotifyTargetsGET } from "@/app/api/ha/notify-targets/route";
import { POST as servicesTestPOST } from "@/app/api/services/test/route";

type Endpoint = {
  name: string;
  call: () => Promise<Response>;
  reads: () => Array<{ mock: any }>;
  configure: () => void;
};

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: "consuela_session=token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const endpoints: Endpoint[] = [
  {
    name: "GET /api/google/state",
    call: () => googleStateGET(request("/api/google/state")),
    reads: () => [mocks.readPublicState],
    configure: () => mocks.readPublicState.mockResolvedValue({ status: "available", state: { connected: false } }),
  },
  {
    name: "GET /api/google/sync-state",
    call: () => googleSyncStateGET(request("/api/google/sync-state")),
    reads: () => [mocks.readCalendarSyncRows, mocks.withAdmin],
    configure: () => {
      mocks.readCalendarSyncRows.mockResolvedValue([]);
      mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn({ collection: () => ({ getFullList: async () => [] }) }));
    },
  },
  {
    name: "GET /api/google/calendars",
    call: () => googleCalendarsGET(request("/api/google/calendars")),
    reads: () => [mocks.ensureGoogleCollections, mocks.isGoogleConnected, mocks.readCalendarSyncRows, mocks.listCalendars],
    configure: () => {
      mocks.ensureGoogleCollections.mockResolvedValue(undefined);
      mocks.isGoogleConnected.mockResolvedValue(true);
      mocks.readCalendarSyncRows.mockResolvedValue([]);
      mocks.listCalendars.mockResolvedValue([]);
    },
  },
  {
    name: "GET /api/ai/providers",
    call: () => aiProvidersGET(request("/api/ai/providers")),
    reads: () => [mocks.listAiProviders, mocks.resolveChatTargets],
    configure: () => {
      mocks.listAiProviders.mockResolvedValue([]);
      mocks.resolveChatTargets.mockResolvedValue([]);
    },
  },
  {
    name: "GET /api/ha/notify-targets",
    call: () => haNotifyTargetsGET(request("/api/ha/notify-targets")),
    reads: () => [mocks.fetchHADeviceStates, mocks.listHANotifyTargets, mocks.withAdmin],
    configure: () => {
      mocks.fetchHADeviceStates.mockResolvedValue([]);
      mocks.listHANotifyTargets.mockReturnValue([]);
      mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn({ collection: () => ({ getFullList: async () => [] }) }));
    },
  },
  {
    name: "POST /api/services/test",
    call: () => servicesTestPOST(request("/api/services/test", { service: "home_assistant" })),
    reads: () => [mocks.runServiceTest],
    configure: () => mocks.runServiceTest.mockResolvedValue({ ok: true, detail: "reachable", ms: 1 }),
  },
];

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: true, member: { id: "p1", name: "Parent", role: "parent" } });
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
});

describe("parent-only System API boundaries", () => {
  it.each(["child", "pet"])("denies %s before any System API read", async (role) => {
    mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    for (const endpoint of endpoints) {
      const response = await endpoint.call();
      expect(response.status, `${endpoint.name} ${role}`).toBe(403);
    }
    for (const endpoint of endpoints) for (const read of endpoint.reads()) expect(read).not.toHaveBeenCalled();
  });

  it("returns 503 and performs no reads when live parent identity is unavailable", async () => {
    mocks.authorizeCurrentParentRequest.mockResolvedValue({ ok: false, status: 503, error: "identity_unavailable" });
    for (const endpoint of endpoints) {
      const response = await endpoint.call();
      expect(response.status, endpoint.name).toBe(503);
    }
    for (const endpoint of endpoints) for (const read of endpoint.reads()) expect(read).not.toHaveBeenCalled();
  });

  it.each(endpoints.map((endpoint) => [endpoint.name, endpoint] as const))("allows a current parent through %s", async (_name, endpoint) => {
    endpoint.configure();
    const response = await endpoint.call();
    expect(response.status).toBe(200);
    for (const read of endpoint.reads()) expect(read).toHaveBeenCalled();
  });
});
