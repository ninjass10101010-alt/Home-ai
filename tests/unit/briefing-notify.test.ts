import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  generateBriefing: vi.fn(),
  selectMorningBriefing: vi.fn(),
  withAdmin: vi.fn(),
  broadcastHouseAlert: vi.fn(),
}));

vi.mock("@/lib/consuela/briefing", () => ({ generateBriefing: mocks.generateBriefing }));
vi.mock("@/db", () => ({ db: { selectMorningBriefing: mocks.selectMorningBriefing } }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn) }));
vi.mock("@/lib/ha/notify", () => ({ broadcastHouseAlert: mocks.broadcastHouseAlert }));

import { POST as briefingPOST } from "../../src/app/api/cron/consuela/briefing/route";

function req() {
  return new NextRequest("http://localhost/api/cron/consuela/briefing", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
}

describe("briefing cron × house-alert digest", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "secret");
    mocks.generateBriefing.mockReset().mockResolvedValue({ sections: [] });
    mocks.selectMorningBriefing.mockReset().mockResolvedValue(undefined);
    mocks.withAdmin.mockReset();
    mocks.broadcastHouseAlert.mockReset().mockResolvedValue({ sent: 3, failed: 0, notes: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pushes the digest when the briefing pref is enabled", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFirstListItem: async () => ({ key: "briefing", enabled: true }),
        }),
      })
    );

    const res = await briefingPOST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.broadcastHouseAlert).toHaveBeenCalledTimes(1);
    expect(body.notified).toEqual({ sent: 3 });
  });

  it("does not push when the pref is off or missing", async () => {
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFirstListItem: async () => {
            throw { status: 404 };
          },
        }),
      })
    );

    const res = await briefingPOST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.broadcastHouseAlert).not.toHaveBeenCalled();
    expect(body.notified).toBeUndefined();
  });
});
