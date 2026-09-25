import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("reconcile operator script", () => {
  it("keeps usage guidance and sanitized repair categories", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/consuela/reconcile-pending-approvals.mjs"),
      "utf8",
    );
    expect(source).toContain("npx tsx scripts/consuela/reconcile-pending-approvals.mjs");
    expect(source).toContain("week_mismatch");
    expect(source).toContain("projection:read");
  });
});
