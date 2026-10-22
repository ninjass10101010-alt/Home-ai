import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  runCurator: vi.fn(),
  undoRun: vi.fn(async () => true),
  listRuns: vi.fn(async (): Promise<any[]> => []),
  authorizeAdminRequest: vi.fn(async () => ({ ok: true })),
  isCronAuthorized: vi.fn(() => true),
}));

vi.mock("@/lib/memory-curator", () => ({
  runCurator: mocks.runCurator,
  undoRun: mocks.undoRun,
  listRuns: mocks.listRuns,
}));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminRequest: mocks.authorizeAdminRequest }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));

import { POST as cronPost } from "@/app/api/cron/consuela/memory-curator/route";
import { GET as curateGet, POST as curatePost } from "@/app/api/family-memory/curate/route";

beforeEach(() => vi.clearAllMocks());

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api", { headers }) as any;
}

describe("the curator cron", () => {
  it("refuses an unauthorized caller", async () => {
    mocks.isCronAuthorized.mockReturnValue(false);
    const res = await cronPost(req());
    expect(res.status).toBe(401);
  });

  it("runs the curator for an authorized caller", async () => {
    mocks.isCronAuthorized.mockReturnValue(true);
    mocks.runCurator.mockResolvedValue({ runId: "run-1", summary: "nothing to do", changes: [] });
    const res = await cronPost(req({ authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    expect(mocks.runCurator).toHaveBeenCalledWith(expect.objectContaining({ trigger: "scheduled" }));
  });
});

describe("the curate API", () => {
  it("refuses a non-parent", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, error: "forbidden", status: 403 } as any);
    const res = await curateGet(req());
    expect(res.status).toBe(403);
  });

  it("lists the runs for a parent", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true } as any);
    mocks.listRuns.mockResolvedValue([{ runId: "run-1", summary: "1 change" }]);
    const res = await curateGet(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
  });

  it("runs the curator on demand", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true } as any);
    mocks.runCurator.mockResolvedValue({ runId: "run-2", summary: "1 change", changes: [] });
    const res = await curatePost(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run" }) }) as any);
    expect(res.status).toBe(200);
    expect(mocks.runCurator).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual" }));
  });

  it("undoes a run on request", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: true } as any);
    const res = await curatePost(
      new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", runId: "run-1" }) }) as any,
    );
    expect(res.status).toBe(200);
    expect(mocks.undoRun).toHaveBeenCalledWith("run-1");
  });
});
