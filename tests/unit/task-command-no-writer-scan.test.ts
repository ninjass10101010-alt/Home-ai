// @vitest-environment node
// Task 10 — full no-writer scan. The browser is no longer a writer for any
// task/config authority: these greps fail the build if a legacy local-first
// writer (a direct task/config POST outside the outbox, a local point/history
// mutation inside a task operation, or the retired snapshot writer) creeps
// back into a caller.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT);

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function lineNumbers(source: string, pattern: RegExp): number[] {
  return source
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

describe("no-writer scan — tasks page", () => {
  const source = read("app/tasks/page.tsx");

  it("never posts a task or config command directly", () => {
    expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/(claim|approve|manage|config)/)).toEqual([]);
  });

  it("never posts the retired snapshot writer", () => {
    expect(lineNumbers(source, /method:\s*["']POST["'][\s\S]{0,200}?\/api\/tasks\/sync/)).toEqual([]);
  });

  it("never mirrors a server task row onto local state", () => {
    // The legacy claim/crew/undo paths each wrote the server's `task` back
    // into the local list. The acknowledgment is the only writer now.
    expect(lineNumbers(source, /setTasks\(prev\s*=>\s*prev\.map\([^)]*data\.task/)).toEqual([]);
    expect(lineNumbers(source, /updated\.crew\s*\?\?\s*x\.crew/)).toEqual([]);
  });

  it("has NO local point writer left at all", () => {
    // Every point movement — an earn, a redemption, a penalty, a manual
    // adjust and a reversal — is a durable command now. There is no
    // `addTransaction` left on this page, and no direct mutation of
    // `weekData.points` outside the adoption callback that re-reads the store.
    expect(lineNumbers(source, /addTransaction\(/)).toEqual([]);
    expect(lineNumbers(source, /points:\s*\{[^}]*\[normalizedName\]/)).toEqual([]);
    expect(lineNumbers(source, /Math\.max\(0,\s*\(prev\.points/)).toEqual([]);
    expect(lineNumbers(source, /currentWeekPoints/)).toEqual([]);
  });

  it("routes reward redemption, penalty and manual adjust through the outbox", () => {
    expect(lineNumbers(source, /route:\s*"\/api\/rewards\/redeem"/).length).toBeGreaterThanOrEqual(1);
    const ledgerRoutes = lineNumbers(source, /route:\s*"\/api\/tasks\/ledger"/);
    expect(ledgerRoutes).toHaveLength(2);
    const ledgerBodies = source.split('route: "/api/tasks/ledger"');
    expect(ledgerBodies[1]).toContain('action: "penalty"');
    expect(ledgerBodies[2]).toContain('action: "adjust"');
  });

  it("sends the parent PIN only on a high-cost redemption", () => {
    // The parent PIN is a ref between the approval step and the command, and
    // is cleared the moment the command is queued.
    expect(source).toContain("parentApprovalPinRef");
    expect(source).toContain('parentApprovalPinRef.current = "";');
  });

  it("enqueues every command through the durable queue", () => {
    expect(lineNumbers(source, /enqueueTaskOperation/)).toEqual([]);
    expect(lineNumbers(source, /queueCommand\(\{/).length).toBeGreaterThan(5);
  });
});

describe("no-writer scan — kid home", () => {
  const source = read("modes/kid/KidHome.tsx");

  it("never posts a task command directly", () => {
    expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/(claim|approve|manage|config)/)).toEqual([]);
  });

  it("never writes the local task or week store", () => {
    expect(lineNumbers(source, /saveTasks\(/)).toEqual([]);
    expect(lineNumbers(source, /saveWeekData\(/)).toEqual([]);
    expect(lineNumbers(source, /addTransaction\(/)).toEqual([]);
  });

  it("verifies a PIN-gated claim BEFORE queueing it", () => {
    // A 10+ claim is PIN-gated for every age, so a wrong PIN must never
    // become a queued (and forever-retried) command.
    const claimBranch = source.slice(source.indexOf("if (task.universal || isSnatchable(task)) {"));
    const verifyAt = claimBranch.indexOf("verifyPinRemote");
    const queueAt = claimBranch.indexOf("queueCommand");
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(queueAt).toBeGreaterThan(verifyAt);
  });

  it("queues an under-10 tap with NO credential at all", () => {
    const tapBranch = source.slice(source.indexOf("completesWithoutPin(user?.role, user?.age, task) && !task.universal"));
    const body = tapBranch.slice(0, tapBranch.indexOf("markOptimistic("));
    expect(body).toContain('action: "complete"');
    expect(body).not.toMatch(/credential:/);
  });
});

describe("no-writer scan — config callers", () => {
  it("RewardSection, WeeklyPrizesCard and action-runner all queue config commands", () => {
    for (const file of [
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      expect(lineNumbers(source, /fetch\(\s*["'`]\/api\/tasks\/config/)).toEqual([]);
      expect(lineNumbers(source, /queueTaskCommand(?:AndFlush)?\(/).length).toBeGreaterThan(0);
    }
  });

  it("no caller stamps a config write as a local success before acknowledgment", () => {
    for (const file of [
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      expect(lineNumbers(source, /saveRewards\(/)).toEqual([]);
      expect(lineNumbers(source, /writeRewardsStamp\(/)).toEqual([]);
      expect(lineNumbers(source, /writeWeeklyPrizesStamp\(/)).toEqual([]);
    }
  });
});

describe("no-writer scan — the credential boundary", () => {
  it("no caller stores a PIN in localStorage", () => {
    for (const file of [
      "app/tasks/page.tsx",
      "modes/kid/KidHome.tsx",
      "components/settings/RewardSection.tsx",
      "components/settings/WeeklyPrizesCard.tsx",
      "lib/action-runner.ts",
    ]) {
      const source = read(file);
      const localStorageSets = source
        .split("\n")
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter(({ text }) => /localStorage\.setItem/.test(text));
      for (const { line, text } of localStorageSets) {
        expect(`${file}:${line} ${text}`).not.toMatch(/pin/i);
      }
    }
  });

  it("no outbox entry can carry a credential field", () => {
    const source = read("lib/task-operation-outbox.ts");
    expect(lineNumbers(source, /payload:\s*\{\s*pin/)).toEqual([]);
  });
});

describe("no-writer scan — the heuristic is gone", () => {
  it("adoptServerWeekData's history-length heuristic no longer exists", () => {
    const source = read("lib/task-utils.ts");
    expect(source).not.toContain("adoptServerWeekData");
    expect(source).toContain("adoptAuthoritativeWeekData");
    // BOTH shapes: the ">=" form in the ack path and the ">" form in the
    // snapshot-merge path.
    expect(
      lineNumbers(source, /history\?\.length\s*\|\|\s*0\)\s*>=\s*\(prev\.history/),
    ).toEqual([]);
    expect(
      lineNumbers(source, /history\?\.length\s*\|\|\s*0\)\s*>\s*\(currentWeekData\.history/),
    ).toEqual([]);
  });

  it("the outbox never compares history length to decide adoption", () => {
    const source = read("lib/task-operation-outbox.ts");
    expect(lineNumbers(source, /history\.length\s*[<>]=?/)).toEqual([]);
  });
});

describe("no-writer scan — the server owns the ledger", () => {
  it("the ledger command reads the canonical penalty, never a client amount", () => {
    const source = read("lib/task-ledger-command.ts");
    // A penalty carries an item id only; the points come from the catalog leg.
    expect(source).toContain("readCatalogPenalty");
    const penaltyParse = source.slice(source.indexOf('if (action === "penalty") {'));
    expect(penaltyParse).not.toContain("value.points");
  });

  it("the ledger command writes under the shared week lock with a fingerprint", () => {
    const source = read("lib/task-ledger-command.ts");
    expect(source).toContain("withWeekLedgerLock");
    expect(source).toContain("applyWeekLedgerOperationLocked");
    expect(source).toContain("ledgerCommandFingerprint");
    expect(source).toContain('source = command.action === "penalty" ? "task-penalty" : "manual-adjust"');
  });

  it("the ledger sources are registered in the canonical list", () => {
    const source = read("lib/task-ledger.ts");
    expect(source).toContain('"task-penalty"');
    expect(source).toContain('"manual-adjust"');
  });
});
