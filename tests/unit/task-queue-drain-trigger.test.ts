// @vitest-environment node
// B1b RED — "a server-queued task command drains without a device sitting on
// /tasks". Symptom (c): `drainDueTaskCommandQueue` is invoked from exactly one
// place in the entire codebase — `src/app/api/tasks/sync/route.ts:68` — so a
// queued command only moves when some device happens to GET /api/tasks/sync
// (the 60s CacheRefresher tick). With every page closed the row never leaves
// `pending` (harness hop c8: pending for >70s). Source-contract test, same
// precedent as tests/unit/task-command-no-writer-scan.test.ts: the property is
// "the drain has at least one trigger outside the read the family is already
// polling", and the only honest way to pin it is to count the callers.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function read(full: string): string {
  return readFileSync(full, "utf8");
}

describe("a server-queued task command drains without a device sitting on /tasks", () => {
  it("has at least two drain callers, at least one outside the sync read", () => {
    const callers = walk(SRC)
      .filter((file) => /drainDueTaskCommandQueue\s*\(/.test(read(file)))
      // The definition module owns the function; it is not a trigger.
      .filter((file) => !file.endsWith("lib/task-command-queue-server.ts"))
      .map((file) => file.slice(SRC.length + 1).replace(/\\/g, "/"));

    expect(callers.length).toBeGreaterThanOrEqual(2);
    expect(callers.some((file) => file !== "app/api/tasks/sync/route.ts")).toBe(true);
  });

  it("keeps a queue-poll heartbeat that survives losing its own rows", () => {
    // scheduleFollowUpPoll re-arms only while a local entry is `serverQueued`
    // (or while this device has already seen a resolution). A device that
    // never held the row — the parent's card — never polls; the heartbeat must
    // not depend on this device owning rows it is watching on someone else's
    // behalf. The fix removes the gate; the test pins that it is gone.
    const source = read(join(SRC, "lib/task-command-store.ts"));
    const fnMatch = source.match(/function scheduleFollowUpPoll\(\)[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    expect(body).not.toMatch(/hasServerRows/);
    expect(body).not.toMatch(/seenResolvedOperationIds/);
  });
});
