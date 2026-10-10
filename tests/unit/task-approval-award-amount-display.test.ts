// @vitest-environment node
// B1a RED — "the award the approval card shows is the award approval pays".
// Symptom (b): the Needs-approval card's meta line printed `task.points` while
// approval pays `pendingApproval.points` (parsePending, task-approval.ts:403).
// For a speed-bonus claim (points 6, bonus 3) the card said 6 and the ledger
// pays 9; for a crew close the card printed the per-payee base once while
// approval pays every member. U1 moved the amount out of the packed meta line
// into its own payout line and read B1a's three-term expression verbatim, so
// this pin now guards the same contract against the new markup.
// Source-contract test, the same precedent as
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
  it("prefers the persisted award, then the pending record, then the base — in that order", () => {
    const awardLine = lineContaining("const award = task.awardedPoints");
    expect(awardLine).toMatch(/task\.awardedPoints \?\? owner\.points \?\? task\.points/);
  });

  it("drives the pending row's payout line from the award, not the base alone", () => {
    // The non-crew payout line: "+Npts for <first name>".
    const payoutLine = lineContaining("+{award}pts");
    expect(payoutLine).toMatch(/\{award\}/);
    expect(payoutLine).toMatch(/for \$\{kid\}/);
    expect(payoutLine).not.toMatch(/task\.points/);
  });

  it("drives the crew award line from the award, per head and crew size", () => {
    // The crew payout line: "+Npts each · 3 people".
    const crewLine = lineContaining("+{award}pts");
    expect(crewLine).toMatch(/each · \$\{task\.crewSize \?\? crew\.length\} people/);
  });
});
