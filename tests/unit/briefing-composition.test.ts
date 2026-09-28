import { describe, it, expect } from "vitest";
import {
  briefingSectionsEmpty,
  briefingShowsCard,
  briefingTaskSourceNote,
} from "@/components/briefing/hooks/useMorningBriefing";
import type { MorningBriefing } from "@/components/briefing/hooks/useMorningBriefing";

/**
 * The two rules that collided in the morning briefing during the merge, pinned
 * as pure functions so neither can be dropped from the merged hook module:
 *
 * - audit P0-4: an empty day collapses the card (silence is only honest when
 *   there is genuinely nothing to say);
 * - points remediation: a day whose chore list could NOT be read is ADMITTED,
 *   because a shorter section count must not read as a calm, quiet day.
 *
 * These call the REAL helpers — no mocks — so a regression in the composition
 * inside `useMorningBriefing.ts` fails here before it reaches the slot.
 */

const empty: MorningBriefing = {
  summary: { events: [], tasks: [], meals: [], suggestions: [] },
} as unknown as MorningBriefing;

const withContent: MorningBriefing = {
  summary: { events: [{ title: "School" }], tasks: [], meals: [], suggestions: [] },
} as unknown as MorningBriefing;

const unavailableTasks: MorningBriefing = {
  summary: { events: [], tasks: [], meals: [], suggestions: [], taskSource: "unavailable" },
} as unknown as MorningBriefing;

const backupTasks: MorningBriefing = {
  summary: { events: [], tasks: [], meals: [], suggestions: [], taskSource: "pb" },
} as unknown as MorningBriefing;

// The shape the slot fixture uses: a briefing that EXISTS but carries no
// summary. The real helpers must read it as empty, or that fixture's hostile
// `briefingShowsCard` would not be the only hostile input it is given.
const noSummary: MorningBriefing = { summary: null } as unknown as MorningBriefing;

describe("briefing composition (audit P0-4 + points remediation)", () => {
  it("audit: an empty day with no admission collapses the card", () => {
    expect(briefingSectionsEmpty(empty)).toBe(true);
    expect(briefingShowsCard(empty)).toBe(false);
  });

  it("audit: a summary-less briefing collapses the card", () => {
    expect(briefingShowsCard(noSummary)).toBe(false);
  });

  it("remediation: content keeps the card", () => {
    expect(briefingSectionsEmpty(withContent)).toBe(false);
    expect(briefingShowsCard(withContent)).toBe(true);
  });

  it("remediation: an unavailable chore list is admitted, not hidden", () => {
    // The sections ARE empty — the OR in `briefingShowsCard` is what admits the
    // card, and it only does so because the source note exists.
    expect(briefingSectionsEmpty(unavailableTasks)).toBe(true);
    expect(briefingTaskSourceNote(unavailableTasks)).toContain("unavailable");
    expect(briefingShowsCard(unavailableTasks)).toBe(true);
  });

  it("remediation: a backup chore list is admitted and named as a backup", () => {
    // The second honest-source branch: chores read from a backup copy are no
    // more complete than missing ones, so the card keeps the slot and says so.
    expect(briefingTaskSourceNote(backupTasks)).toContain("backup");
    expect(briefingShowsCard(backupTasks)).toBe(true);
  });
});
