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
  return source
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}

const NORMAL_SURFACES = [
  "app/tasks/page.tsx",
  "modes/kid/KidHome.tsx",
  "lib/push-local-to-pb.ts",
];

const RETIRED_SNAPSHOT_ERROR = ["task", "snapshot", "write", "retired"].join("_");
const TASK_LEDGER_ERROR = ["task", "ledger", "write", "requires", "command"].join("_");

const BROWSER_TASK_WRITERS: Array<[string, RegExp]> = [
  ["create tasks", /gatewayCreate\(\s*["']tasks["']/],
  ["update tasks", /gatewayUpdate\(\s*["']tasks["']/],
  ["delete tasks", /gatewayDeleteOk\(\s*["']tasks["']/],
  ["delete tasks", /gatewayDelete\(\s*["']tasks["']/],
  ["create week_data", /gatewayCreate\(\s*["']week_data["']/],
  ["update week_data", /gatewayUpdate\(\s*["']week_data["']/],
  ["create week_archive", /gatewayCreate\(\s*["']week_archive["']/],
  ["update week_archive", /gatewayUpdate\(\s*["']week_archive["']/],
  ["delete week_archive", /gatewayDeleteOk\(\s*["']week_archive["']/],
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

  it("every task/week/archive write method refuses the browser first", () => {
    const missing: string[] = [];
    for (const name of LEDGER_WRITE_METHODS) {
      const at = source.indexOf(`${name}: async`);
      if (at === -1) {
        missing.push(`${name} (method not found)`);
        continue;
      }
      const head = source.slice(at, at + 200);
      if (!/if \(!isServer\(\)\) refuseTaskLedgerWrite\(\)/.test(head)) missing.push(name);
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
