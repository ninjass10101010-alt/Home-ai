// @vitest-environment jsdom
/**
 * Last-mile wall/1920 critic contracts.
 *
 * Each assertion here pins a defect that was visible on a 1920 wall screenshot
 * and is invisible to the type floor, the tap-target scan and the token contrast
 * maths. They are deliberately a mix of rendered-class and source-string checks:
 * the rendered checks catch a class that was dropped, the source checks catch a
 * class that came back, because several of these only exist as an *ordering* or
 * *absence* property that no DOM assertion can see.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SegmentedControl from "@/components/ui/SegmentedControl";
import EmptyState from "@/components/ui/EmptyState";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel: string) => readFileSync(resolve(__dirname, "../../", rel), "utf8");

const weekCard = read("src/components/calendar/ConsuelaWeekCard.tsx");
const segmented = read("src/components/ui/SegmentedControl.tsx");
const emptyState = read("src/components/ui/EmptyState.tsx");
const clem = read("src/components/meals/ClemAssistant.tsx");
const topBar = read("src/components/ui/TopBar.tsx");
const emergency = read("src/app/emergency/page.tsx");
const home = read("src/app/page.tsx");
const globals = read("src/app/globals.css");

let root: Root | null = null;

function render(ui: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host.firstChild as HTMLElement;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("accent weight is proportional to the action (wall 1920)", () => {
  // A `w-full` primary SoftButton inside a full-measure card is a 1300px solid
  // accent bar. "Review the week" is a tertiary action on /calendar and was the
  // loudest object on the page — heavier than the month grid it sits under.
  it("never renders the week review as a full-width accent bar", () => {
    expect(weekCard).not.toMatch(/Review the week[\s\S]{0,200}?w-full/);
    expect(weekCard).not.toMatch(/w-full[^"]*"[\s\S]{0,120}?Review the week/);
    // …and the row that replaced it carries a lead-in, so the control is
    // described rather than merely shrunk.
    expect(weekCard).toMatch(/flex flex-wrap items-center gap-x-4/);
    expect(weekCard).toMatch(/Ask Consuela to read the week/);
  });
});

describe("SegmentedControl inactive label clears AA in light", () => {
  it("uses the secondary ink, not the muted one", () => {
    // `--color-text-muted` is #6f6f6f on the #f0f2f7 track: 4.49:1, a hair under
    // the 4.5:1 body floor, and it was flagged on every segmented control in the
    // app. The two tokens are aliases in dark, so this is a light-only change.
    expect(segmented).not.toMatch(/"text-text-muted hover:text-text-secondary"/);
    expect(segmented).toMatch(/"text-text-secondary hover:text-text-primary"/);
  });

  it("puts the secondary ink on the unselected radios", () => {
    const host = render(
      <SegmentedControl
        aria-label="Week view"
        value="calendar"
        options={[{ id: "calendar", label: "Calendar" }, { id: "schedule", label: "Schedule" }]}
        onChange={() => {}}
      />
    );
    const inactive = host.querySelectorAll<HTMLElement>('[role="radio"]')[1];
    expect(inactive.className).toContain("text-text-secondary");
    expect(inactive.className).not.toContain("text-text-muted");
  });
});

describe("EmptyState fills the surface it is given", () => {
  // The wall photo tile is a `row-span-2` cell ~780px tall. A flat empty state
  // pinned to the top of it left ~600px of dead tile below the copy, so the
  // emptiest object on the wall read as a rendering failure.
  it("centres a standalone flat state in its parent", () => {
    const state = render(<EmptyState title="No photos yet" description="Add one." icon="📸" flat />);
    expect(state.className).toContain("h-full");
    // …while the inside-card variant keeps its reserved height, which is what
    // holds the rhythm between sibling cards.
    expect(state.className).not.toContain("min-h-56");
  });

  it("keeps the reserved height inside a card body", () => {
    expect(emptyState).toMatch(/insideCard\s*\n\s*\?\s*"min-h-56 p-2"/);
  });

  // 48px photographic emoji is a sticker with its own lighting and palette,
  // parked above 14px type. WidgetCard's seated badge was already normalised to
  // 30px; this closes the gap between the two glyph scales.
  it("keeps the glyph on the 30px card-badge scale", () => {
    const state = render(<EmptyState title="Quiet day" description="No events today." icon="🌿" />);
    const glyph = state.firstChild as HTMLElement;
    expect(glyph.className).toContain("text-[30px]");
    expect(emptyState).not.toContain("sm:text-5xl");
  });
});

describe("a glass surface never carries the positioning it needs", () => {
  // `.glass-strong` / `.material-thick` is an UNLAYERED rule declaring
  // `position: relative` (it hosts its own highlight layers), and unlayered
  // out-ranks `@layer utilities`. So `fixed` on the same element silently
  // degraded to `relative` and the "Ask Clem" trigger laid out in flow, landing
  // 320px from the left over the "Nothing on your list" card, half off-screen.
  it("keeps `fixed` off the glass element in ClemAssistant", () => {
    expect(clem).toMatch(/className="pointer-events-none fixed bottom-24 right-4/);
    expect(clem).toMatch(/clem-fab glass-strong tap pointer-events-auto relative/);
  });

  it("gives the Ask Clem trigger a name and a 44px hit box", () => {
    expect(clem).toMatch(/aria-label="Ask Clem"/);
    expect(clem).toMatch(/h-14 w-14/);
  });

  // The cart glyph was the page badge, the "All" filter chip and every card
  // corner badge on the Shop tab, so the one control that opens a conversation
  // advertised itself as the thing the page already is.
  it("drops the cart glyph for a lucide mark", () => {
    expect(clem).toContain("MessagesSquare");
    expect(clem).not.toMatch(/>\s*🛒\s*</);
    expect(clem).toMatch(/aria-hidden="true" \/>\s*\n\s*<\/button>/);
  });
});

describe("icon-only controls carry a name and a 44px target", () => {
  it("labels TopBar's back control and gives it a hit box", () => {
    // Icon-only `<Link>` with no text and no aria-label announced as "link";
    // at `w-9 h-9` its box was 36×36, under the house 44px target.
    expect(topBar).toMatch(/aria-label="Back to Home"/);
    expect(topBar).toMatch(/hit-44 flex items-center justify-center w-9 h-9/);
  });
});

describe("/emergency", () => {
  // Raw `--color-accent-rose` is #e11d48 in light: 4.35:1 at 16px semibold on
  // near-white, under the 4.5:1 body floor, on the title, the 911 heading and
  // the 911 link.
  it("mixes rose toward the theme ink for text", () => {
    expect(emergency).toMatch(/const ROSE_INK = "color-mix\(in srgb, var\(--color-accent-rose\) 55%, var\(--color-text-primary\)\)"/);
    expect(emergency).not.toMatch(/text-\[var\(--color-accent-rose\)\]/);
    expect(topBar).toMatch(/const emergencyInk = "color-mix\(in srgb, var\(--color-accent-rose\) 55%, var\(--color-text-primary\)\)"/);
  });

  // Stretched to the shell's 1300px measure on a wall, each situation row was a
  // 1300×64 sliver with ~950px of nothing between its label and its "Mom or Dad".
  it("pairs the situation rows instead of stretching them", () => {
    expect(emergency).toMatch(/grid gap-2 sm:grid-cols-2/);
  });
});

describe("Home bento composition", () => {
  // Quick ask was the only tile in the grid with no header band: the badge hung
  // off the corner with nothing beside it and the body floated in an empty box.
  it("gives Quick ask the same header band as its siblings", () => {
    expect(home).toMatch(/case "aiQuickAsk"[\s\S]{0,900}?<SectionCard/);
    expect(home).toMatch(/title="Quick ask"[\s\S]{0,320}?centeredHeader/);
    // …and it is no longer a bare WidgetCard.
    expect(home).not.toMatch(/<WidgetCard tone="#8b5cf6" icon=\{<HomeWidgetIcon variant="ask"/);
  });

  // `progress` draws a percentage numeral under the label, which made Week the
  // only tile with a three-line right column — so it grew past the two tiles it
  // shares a baseline with and the band stopped reading as three equal tiles.
  it("keeps the three KPI tiles the same height", () => {
    expect(home).toMatch(/label="Week"[\s\S]{0,400}?progress=\{null\}/);
  });

  // `SoftButton` is a flex row with no width constraint of its own, so the first
  // label with a space in it breaks when the row tightens — which is how "Plan
  // Meals" and "Open Tasks" ended up double-height beside a one-line "More…".
  it("keeps the bottom action row single-line", () => {
    expect(home).toMatch(/className="w-full whitespace-nowrap">Plan Meals/);
    expect(home).toMatch(/className="w-full whitespace-nowrap">Open Tasks/);
    expect(home).toMatch(/<MoreButton className="min-w-0 flex-1 whitespace-nowrap"/);
  });
});

describe("the grown calendar empty state is not inert", () => {
  // Source-order regression. `.calendar-empty` declares the shorthand
  // `border: 1px dashed …` and sits LATER in the unlayered stylesheet, so at
  // equal specificity it reinstated the dashed outline and made the whole
  // `.calendar-empty-grow` rule a no-op — the grown state kept shipping the
  // dashed box that rule was written to remove. A Tailwind `border-solid` utility
  // cannot fix it: unlayered rules out-rank `@layer utilities`.
  it("out-specifies `.calendar-empty` so the fill actually wins", () => {
    expect(globals).toMatch(/html \.calendar-empty\.calendar-empty-grow \{/);
    const growAt = globals.indexOf("html .calendar-empty.calendar-empty-grow {");
    const dashedAt = globals.indexOf("border: 1px dashed");
    expect(growAt).toBeGreaterThan(-1);
    expect(dashedAt).toBeGreaterThan(-1);
    // The doubled class is the whole mechanism, so it must be present wherever
    // the override is declared.
    const override = globals.slice(growAt, globals.indexOf("}", growAt));
    expect(override).toMatch(/border-style: solid/);
  });
});
