import { describe, it, expect, afterEach } from "vitest";
import { buildConsuelaSystemPrompt, buildClemSystemPrompt } from "@/lib/consuela-prompts";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("system prompt date context", () => {
  it("tells Consuela today's family date (no UTC guess)", () => {
    process.env.TZ = "America/Detroit";
    const prompt = buildConsuelaSystemPrompt(new Date("2026-09-02T00:36:00Z"));
    expect(prompt).toContain("Today is Tue, 2026-09-01 (America/Detroit)");
    expect(prompt).toContain("Yesterday was Mon, 2026-08-31");
    expect(prompt).toContain("this week's Monday is 2026-08-31");
    expect(prompt).toContain("add_meal tool");
  });

  it("adds the same context block to Clem's prompt", () => {
    process.env.TZ = "America/Detroit";
    const prompt = buildClemSystemPrompt(new Date("2026-09-02T00:36:00Z"));
    expect(prompt).toContain("Today is Tue, 2026-09-01 (America/Detroit)");
  });
});

describe("task-action truth (adult prompt)", () => {
  // The model used to invent a "Settings → Family → Approvals" screen and a
  // "bulk delete pending approval" that do not exist. The prompt must say how
  // task actions actually behave so it stops sending users to a fake screen.
  const prompt = buildConsuelaSystemPrompt(new Date("2026-09-21T12:00:00Z"));

  it("says deletes are immediate (no approval)", () => {
    expect(prompt).toContain("Delete a chore (delete_task): it is removed IMMEDIATELY");
    expect(prompt).toContain("no PIN, no approval, no queue");
  });

  it("points completions at the Tasks 'Needs approval' section only", () => {
    expect(prompt).toContain('"Needs approval"');
    expect(prompt).toContain("only place");
  });

  it("forbids the fictional Settings → Approvals screen", () => {
    expect(prompt).toContain('NO "Settings → Approvals" page');
    expect(prompt).toContain('NO "bulk delete approval"');
  });
});
