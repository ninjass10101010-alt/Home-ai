import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GUARDED = ["getLevel", "BADGES"];
const POLICY_MODULE = "src/components/leaderboard/level.ts";
const DEFINITION_MODULE = "src/types/tasks.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[^\n]*?\/\/.*$/gm, " ");
}

describe("the level/badge null policy is the only way to read a level or a badge", () => {
  it("no production module reaches getLevel or BADGES except the policy module", () => {
    const offenders = sourceFiles("src")
      .filter((file) => file !== POLICY_MODULE && file !== DEFINITION_MODULE)
      .filter((file) => {
        const code = stripComments(readFileSync(file, "utf8"));
        return GUARDED.some((name) => new RegExp(`\\b${name}\\b`).test(code));
      });
    expect(offenders).toEqual([]);
  });

  it("the policy module is the one that owns both", () => {
    const policy = readFileSync(POLICY_MODULE, "utf8");
    for (const name of GUARDED) {
      expect(policy).toContain(name);
    }
  });

  it("the definitions themselves still live in the types module", () => {
    const definitions = readFileSync(DEFINITION_MODULE, "utf8");
    expect(definitions).toContain("export const BADGES");
    expect(definitions).toContain("export function getLevel");
  });
});
