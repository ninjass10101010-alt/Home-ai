import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = "scripts/consuela/reconcile-pending-approvals.mjs";

function sourcePathFor(specifier: string): string {
  return `./${specifier.replace("../../src/", "src/").replace(/\.m?js$/, ".ts")}`;
}

describe("reconcile operator import chain", () => {
  it("resolves every source module the operator script imports, under npx tsx", async () => {
    const source = readFileSync(resolve(process.cwd(), SCRIPT), "utf8");
    const specifiers = [
      ...new Set(
        [...source.matchAll(/(?:from|import)\(?\s*"(\.\.\/\.\.\/src\/[^"]+)"/g)]
          .map((match) => match[1]),
      ),
    ];
    expect(specifiers.length).toBeGreaterThanOrEqual(2);

    for (const specifier of specifiers) {
      const path = sourcePathFor(specifier);
      const { stdout } = await run(
        "node_modules/.bin/tsx",
        [
          "--eval",
          `import(${JSON.stringify(path)}).then((m) => console.log("resolved:" + typeof m)).catch((error) => { console.error("unresolved:" + String(error && error.message)); process.exit(1); })`,
        ],
        { cwd: process.cwd(), timeout: 120_000 },
      );
      expect(stdout.trim()).toBe("resolved:object");
    }
  }, 240_000);
});
