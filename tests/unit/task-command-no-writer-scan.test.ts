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

  it("never reverses points locally on an undo", () => {
    // The paid-undo reversal is a server command; the local ledger is the
    // server's. `addTransaction` may only survive on the reward-redeem,
    // penalty and manual-adjust paths, which have no outbox route.
    const adjustHits = lineNumbers(source, /addTransaction\(/);
    const lines = source.split("\n");
    const contexts = adjustHits.map((n) => lines[n - 1]);
    expect(contexts.some((line) => /Undo:/.test(line))).toBe(false);
    expect(contexts.some((line) => /earn/.test(line))).toBe(false);
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
    expect(
      lineNumbers(source, /history\?\.length\s*\|\|\s*0\)\s*>=\s*\(prev\.history/),
    ).toEqual([]);
  });
});
