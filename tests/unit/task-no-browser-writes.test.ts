// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(process.cwd(), "src");
const TESTS = join(process.cwd(), "tests");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function sourceFilesToString(relative: string[]): string {
  return relative.map(read).join("\n");
}

function lineNumbers(source: string, pattern: RegExp): number[] {
  // Matched against the whole source, not line by line, so a pattern that spans
  // a line break still reports the line the call starts on.
  const scanner = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const hits: number[] = [];
  for (let match = scanner.exec(source); match; match = scanner.exec(source)) {
    hits.push(source.slice(0, match.index).split("\n").length);
    if (match[0].length === 0) scanner.lastIndex += 1;
  }
  return hits;
}

const NORMAL_SURFACES = [
  "app/tasks/page.tsx",
  "modes/kid/KidHome.tsx",
  "lib/push-local-to-pb.ts",
];

const RETIRED_SNAPSHOT_ERROR = ["task", "snapshot", "write", "retired"].join("_");
const TASK_LEDGER_ERROR = ["task", "ledger", "write", "requires", "command"].join("_");

// DotAll so a call whose collection argument is split across lines still
// matches; the lazy bounded gap keeps the match inside that one call. Built
// through `RegExp` (not a literal) because the project target is ES2017 and a
// literal `s` flag is a type error there — the flag itself is applied at run
// time, which is what makes the multi-line form observable.
const browserWrite = (fn: string, collection: string) =>
  new RegExp(`${fn}(.{0,80}?)["']${collection}["']`, "s");

const BROWSER_TASK_WRITERS: Array<[string, RegExp]> = [
  ["create tasks", browserWrite("gatewayCreate", "tasks")],
  ["update tasks", browserWrite("gatewayUpdate", "tasks")],
  ["delete tasks", browserWrite("gatewayDeleteOk", "tasks")],
  ["delete tasks", browserWrite("gatewayDelete", "tasks")],
  ["create week_data", browserWrite("gatewayCreate", "week_data")],
  ["update week_data", browserWrite("gatewayUpdate", "week_data")],
  ["create week_archive", browserWrite("gatewayCreate", "week_archive")],
  ["update week_archive", browserWrite("gatewayUpdate", "week_archive")],
  ["delete week_archive", browserWrite("gatewayDeleteOk", "week_archive")],
];

const LEDGER_WRITE_METHODS = [
  "insertTask",
  "updateTask",
  "deleteTask",
  "upsertTask",
  "deleteTaskByTaskId",
  "upsertWeekData",
  "archiveWeek",
];

describe("no browser task/ledger sync call sites", () => {
  it("the Tasks page, KidHome and the Settings cloud push carry no sync helper", () => {
    expect(lineNumbers(sourceFilesToString(NORMAL_SURFACES), /syncTasksToPB|syncWeekDataToPB|syncAllTasksToPB/)).toEqual([]);
  });

  it("the Settings cloud push never re-adds a tasks/ledger/reward leg", () => {
    const source = read("lib/push-local-to-pb.ts");
    expect(lineNumbers(source, /syncArchiveToPB|syncRewardsToPB|syncPenaltiesToPB|syncHallOfFameToPB|syncWeeklyPrizesToPB/)).toEqual([]);
  });

  it("no source or test still names the retired snapshot-write error", () => {
    const hits: string[] = [];
    for (const file of [...walk(ROOT), ...walk(TESTS)]) {
      if (readFileSync(file, "utf8").includes(RETIRED_SNAPSHOT_ERROR)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});

describe("no browser db task/week/archive writer", () => {
  const source = read("db/index.ts");

  it("no gateway write call targets tasks, week_data or week_archive", () => {
    const found: string[] = [];
    for (const [label, pattern] of BROWSER_TASK_WRITERS) {
      for (const line of lineNumbers(source, pattern)) found.push(`${label} at db/index.ts:${line}`);
    }
    expect(found).toEqual([]);
  });

  it("every task/week/archive write method refuses the browser as its first statement", () => {
    const missing: string[] = [];
    for (const name of LEDGER_WRITE_METHODS) {
      const at = source.indexOf(`${name}: async`);
      if (at === -1) {
        missing.push(`${name} (method not found)`);
        continue;
      }
      const arrow = source.indexOf("=>", at);
      const open = arrow === -1 ? -1 : source.indexOf("{", arrow);
      if (open === -1) {
        missing.push(`${name} (method body not found)`);
        continue;
      }
      if (!/^\s*if \(!isServer\(\)\) refuseTaskLedgerWrite\(\);/.test(source.slice(open + 1))) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("exports the stable refusal code the writers use", () => {
    expect(source).toContain(
      `export const ${["TASK", "LEDGER", "WRITE", "ERROR"].join("_")} = "${TASK_LEDGER_ERROR}";`
    );
    expect(source).toMatch(/function refuseTaskLedgerWrite\(\): never \{/);
  });
});
