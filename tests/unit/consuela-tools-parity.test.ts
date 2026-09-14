// ai/TOOLS.md must document every runtime tool (2026-09-10). Previously only
// the kid allowlist was drift-guarded; adult doc drift is how the model keeps
// learning about tools that were purged (get_weather's simulation note etc).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getAllTools } from "@/lib/hermes-tools";

describe("TOOLS.md parity", () => {
  const doc = readFileSync(resolve(__dirname, "../../ai/TOOLS.md"), "utf8");
  it("mentions every tool by name", () => {
    const missing = getAllTools().map((t) => t.definition.name).filter((n) => !doc.includes(`\`${n}\``));
    expect(missing).toEqual([]);
  });
});
