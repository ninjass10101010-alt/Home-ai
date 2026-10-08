// @vitest-environment node
// Wave 3 Task 10 — the normal (non-migration) task/week/ledger writer surface is
// empty. This is a STATIC call-site test on purpose: the Wave 1 command seam is
// behavioural and heavily covered elsewhere, but "a browser surface can write
// task or ledger data again" is a single grep away from regressing, so the
// shape of the writer surface is pinned directly against the source text.
//
// GET /api/tasks/sync is deliberately NOT banned here: it is the cross-device
// read endpoint (rollover + reconcile + snapshot) and stays.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");
const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// The project target is ES2017, where an `s`-flagged regex LITERAL is a type
// error. The flag is applied at run time through `RegExp` instead — same match
// semantics, and the multi-line (post-effect-spanning) form stays observable.
const DOTALL = "s";

const TASKS_PAGE = "app/tasks/page.tsx";
const KID_HOME = "modes/kid/KidHome.tsx";
const MIGRATION_PUSH = "lib/push-local-to-pb.ts";

// The retired structured whole-body push family. Every member of it wrote
// normal production data; none survives, with or without a migration caller.
const RETIRED_SYNC_HELPERS =
  "syncTasksToPB|syncWeekDataToPB|syncArchiveToPB|syncRewardsToPB|syncPenaltiesToPB|syncWeeklyPrizesToPB|syncAllTasksToPB|syncHallOfFameToPB";

const LEGACY_SYNC = "/api/tasks/sync";

describe("normal task surfaces do not POST tasks or weekData to the legacy sync route", () => {
  const page = source(TASKS_PAGE);

  it("carries no snapshot POST to the legacy sync route in either argument order", () => {
    expect(
      page.match(
        new RegExp(
          `fetch\\(\\s*["']${LEGACY_SYNC}["'][\\s\\S]{0,500}?method:\\s*["']POST["']`,
          DOTALL
        )
      )
    ).toBeNull();
    expect(
      page.match(
        new RegExp(
          `method:\\s*["']POST["'][\\s\\S]{0,500}?fetch\\(\\s*["']${LEGACY_SYNC}["']`,
          DOTALL
        )
      )
    ).toBeNull();
  });

  it("keeps no pending-push ref and calls no whole-body sync helper", () => {
    expect(page).not.toContain("pbSyncPendingRef");
    expect(page).not.toContain("syncAllTasksToPB");
    expect(page).not.toContain("syncWeekDataToPB");
    expect(page).not.toMatch(new RegExp(RETIRED_SYNC_HELPERS));
  });
});

describe("KidHome does not call structured task writers", () => {
  it("has no sync helper call site; localStorage stays a cache only", () => {
    const kidHome = source(KID_HOME);
    expect(kidHome).not.toContain("syncTasksToPB");
    expect(kidHome).not.toMatch(new RegExp(RETIRED_SYNC_HELPERS));
  });
});

describe("the local migration push no longer carries task, week, or ledger data", () => {
  const migrationPush = source(MIGRATION_PUSH);

  it("calls no task/week/ledger sync helper", () => {
    expect(migrationPush).not.toContain("syncAllTasksToPB");
    expect(migrationPush).not.toContain("syncWeekDataToPB");
    expect(migrationPush).not.toMatch(new RegExp(RETIRED_SYNC_HELPERS));
  });

  it("retains only the non-task migration collections", () => {
    // The explicit migration collections, in push order — the six
    // `SAFE_LOCAL_PUSH_COLLECTIONS` the Settings push is allowed to write.
    // Adding a task, week, ledger, reward, weekly-config, family-goal or
    // emergency-contact collection here is a regression: those are
    // server-owned now and the push would report a persistence that never
    // happened (and the emergency-contact leg is a legacy roster write the
    // parent-authorized Settings path owns).
    const collections = [...migrationPush.matchAll(/collection:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(collections).toEqual([
      "grocery_list_items",
      "pantry_items",
      "meal_plan_entries",
      "recipes",
      "events",
      "schedules",
    ]);
    // The declared allowlist and the implemented legs must not drift apart.
    const declared = [...source(MIGRATION_PUSH).matchAll(/^  "([a-z_]+)",$/gm)].map((m) => m[1]);
    expect(declared).toEqual(collections);
  });
});

describe("the retired structured sync family is gone from production source", () => {
  it("no production module exports or calls any sync*ToPB task/ledger helper", () => {
    const offenders: string[] = [];
    for (const file of [
      "lib/task-utils.ts",
      "db/index.ts",
      "db/pb-db.ts",
      TASKS_PAGE,
      KID_HOME,
      MIGRATION_PUSH,
      "lib/task-command-store.ts",
    ]) {
      if (new RegExp(RETIRED_SYNC_HELPERS).test(source(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("GET /api/tasks/sync stays the cross-device read endpoint", () => {
  it("the Tasks page still pulls the snapshot (the read is NOT retired)", () => {
    const page = source(TASKS_PAGE);
    expect(page).toContain(`fetch("${LEGACY_SYNC}")`);
  });

  it("the route still answers GET and still refuses every browser write body", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/tasks/sync/route.ts"), "utf8");
    expect(route).toMatch(/export\s+(?:async\s+)?function\s+GET\b/);
    expect(route).toMatch(/export\s+(?:async\s+)?function\s+POST\b/);

    // Pin the refusal's TRIGGER and its STATUS, not the spelling of the error
    // constant: a body carrying either snapshot key is what the 410 is for, and
    // a body carrying neither is a 400. (`tasks-sync-legs` drives the handler
    // itself end-to-end; this pins the shape so the gate cannot be dropped or
    // quietly downgraded to a 400.)
    const gate = route.match(
      new RegExp(`hasOwnProperty\\.call\\(record,\\s*"(\\w+)"\\)([\\s\\S]{0,80}?)hasOwnProperty\\.call\\(record,\\s*"(\\w+)"\\)([\\s\\S]{0,300}?)status:\\s*(\\d+)`, DOTALL)
    );
    expect(gate).not.toBeNull();
    expect([gate![1], gate![3]].sort()).toEqual(["tasks", "weekData"]);
    expect(gate![5]).toBe("410");
    expect(route).toMatch(/status:\s*400/);
  });
});
