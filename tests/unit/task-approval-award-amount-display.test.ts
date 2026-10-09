// @vitest-environment node
// B1a RED — "the award the approval card shows is the award approval pays".
// Symptom (b): the Needs-approval card's meta line prints `task.points` while
// approval pays `pendingApproval.points` (parsePending, task-approval.ts:403).
// For a speed-bonus claim (points 6, bonus 3) the card says 6 and the ledger
// pays 9; for a crew close the card prints the per-payee base once while
// approval pays every member. Source-contract test, the same precedent as
// tests/unit/task-command-no-writer-scan.test.ts: rendering the 3,779-line
// tasks page in jsdom is not worth the flake.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
const LINES = SOURCE.split("\n");

function lineContaining(needle: string): string {
  const line = LINES.find((candidate) => candidate.includes(needle));
  if (!line) throw new Error(`tasks page no longer contains: ${needle}`);
  return line;
}

describe("the award the approval card shows is the award approval pays", () => {
  it("drives the pending row's meta line from pendingApproval.points, not task.points", () => {
    // The non-crew Needs-approval meta line: "`byName · tapped <date> · Npts`".
    const metaLine = lineContaining('task.pendingApproval!.byName.split(" ")[0]');
    expect(metaLine).toMatch(/pendingApproval!\.points/);
    expect(metaLine).not.toMatch(/task\.points/);
  });

  it("drives the crew award line from the paid amount, not the task's base points", () => {
    // The crew Needs-approval line: "🤝 Crew N/M · Npts each · names".
    const crewLine = lineContaining("Crew ${crew.length}");
    expect(crewLine).toMatch(/pendingApproval!\.points/);
    expect(crewLine).not.toMatch(/task\.points/);
  });
});
