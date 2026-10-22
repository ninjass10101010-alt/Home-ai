import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  writePlaybook: vi.fn(),
  patchPlaybook: vi.fn(),
  getPlaybook: vi.fn(),
  listActivePlaybooks: vi.fn(async (): Promise<any[]> => []),
  incrementPlaybookUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/memory-playbooks", () => ({
  writePlaybook: mocks.writePlaybook,
  patchPlaybook: mocks.patchPlaybook,
  getPlaybook: mocks.getPlaybook,
  listActivePlaybooks: mocks.listActivePlaybooks,
  incrementPlaybookUsage: mocks.incrementPlaybookUsage,
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => vi.fn(async () => []) }) }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn(), getAuthedPB: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn(async () => ({ callService: vi.fn(async () => ({})) })) }));

import { getTool, buildToolsForOpenAI } from "@/lib/hermes-tools";

beforeEach(() => vi.clearAllMocks());

describe("playbook tool gating", () => {
  it("parents get the playbook tools; kids never do", () => {
    const adult = buildToolsForOpenAI({ houseControl: true, role: "parent" }).map((t) => t.function.name);
    for (const name of ["write_playbook", "patch_playbook", "read_playbook"]) expect(adult).toContain(name);
    const kid = buildToolsForOpenAI({ houseControl: false, role: "child" }).map((t) => t.function.name);
    for (const name of ["write_playbook", "patch_playbook", "read_playbook"]) expect(kid).not.toContain(name);
  });
});

describe("write_playbook", () => {
  it("writes a procedure at a stable slug", async () => {
    mocks.writePlaybook.mockResolvedValue({ id: "p1", slug: "meals.add_meal", version: 1 });
    const out = JSON.parse(await getTool("write_playbook")!.handler({
      slug: "meals.add_meal", title: "Attach a meal emoji", body: "Use a relevant emoji.", domain: "meals", trigger: "add_meal",
    }));
    expect(out.ok).toBe(true);
    expect(mocks.writePlaybook).toHaveBeenCalledWith(expect.objectContaining({ slug: "meals.add_meal" }));
  });

  it("rejects a missing slug", async () => {
    const out = JSON.parse(await getTool("write_playbook")!.handler({ title: "x", body: "y" }));
    expect(out.error).toBeTruthy();
  });
});

describe("patch_playbook", () => {
  it("replaces the body of a playbook", async () => {
    mocks.patchPlaybook.mockResolvedValue({ id: "p1", slug: "meals.add_meal", version: 2 });
    const out = JSON.parse(await getTool("patch_playbook")!.handler({ slug: "meals.add_meal", body: "new body" }));
    expect(out.ok).toBe(true);
    expect(mocks.patchPlaybook).toHaveBeenCalledWith("meals.add_meal", "new body", "agent");
  });
});

describe("read_playbook", () => {
  it("returns the body of one playbook", async () => {
    mocks.getPlaybook.mockResolvedValue({ slug: "meals.add_meal", title: "Attach a meal emoji", body: "Use a relevant emoji." });
    const out = JSON.parse(await getTool("read_playbook")!.handler({ slug: "meals.add_meal" }));
    expect(out.body).toBe("Use a relevant emoji.");
    expect(mocks.incrementPlaybookUsage).toHaveBeenCalledWith("meals.add_meal");
  });
});
