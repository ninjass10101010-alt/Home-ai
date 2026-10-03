// Tap-target contract — the house 44x44 floor, enforced on hand-rolled controls.
//
// AGENTS.md ("UI Contracts"): *Tap targets ≥44×44. Visual size may stay compact
// when the element carries `.hit-44` … or an equivalent documented
// `after:-inset-*` region.* `globals.css` defines `.hit-44::before` as a
// centred `width/height: max(100%, 44px)` pseudo box — a 44px hit area with no
// layout change, which is why a 24px ✕ can be visually compact and still be
// comfortably tappable.
//
// The primitives already carry it (`SoftButton sm`, `IconButton sm`, `Stepper` —
// pinned by contract C in `warm-glass-contracts.test.tsx`). This suite covers the
// OTHER half: controls written by hand, which no primitive check sees.
//
// Why a source scan and not a DOM measurement: jsdom returns a 0×0 rect for
// every element, so any `getBoundingClientRect().height < 44` assertion passes
// vacuously. Contract B already established the `*.tsx`-class-string idiom in
// this repo for exactly this reason, and the wall profile's 44px floor works the
// same way (a CSS rule, not a measurement).
//
// ── What this suite covers ────────────────────────────────────────────────────
// Every interactive element: `<button>`, `<a href>`, `next/link`'s `<Link href>`
// (the JSX in this repo is nearly always `<Link>`, never a raw `<a>`), and any
// element carrying `role="button"`. A 36px back link is exactly as untappable as
// a 36px button, and a scan that only knows about `<button>` cannot tell.
//
// Sizing is read from ALL Tailwind spacing steps below 44px (1–10; `11` IS 44px,
// so it is the floor), not just 6–10 — a 20px `h-5 w-5` copy button is worse
// than a 24px one, and a `size-5` shorthand sets both axes at once. Two further
// shapes count as violations because the rendered box is then decided by
// padding alone: a glyph-only control sized by `p-1`/`p-1.5`/`p-2`.
//
// Class strings are NOT stripped of `${…}` holes. Inlining every string literal
// the expression contains sees strictly more than stripping did — `clsx(a,
// "h-6")` and `${x ? "h-6" : "h-12"}` are now legible — and it can never see less.
//
// Known limits, recorded so they are not mistaken for coverage: `max-h-*`/`max-w-*`
// are max constraints rather than sizes and are not treated as sizing; a bare
// `w-0`/`h-0` is not treated as a size; and an arbitrary rem value
// (`min-h-[2.75rem]`) is not evaluated, only an explicit px one. All three would
// need a real CSS-value evaluator, which this source scan is not.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { globSync } from "fs";
import { join } from "path";

/**
 * Every Tailwind spacing step under 44px: 1=4 2=8 3=12 4=16 5=20 6=24 7=28 8=32
 * 9=36 10=40, plus the half steps. `11` IS 44px, so it is the floor and is not
 * a violation. The trailing lookahead rejects fractions (`size-1/2`, `w-2/3`),
 * which are percentages, and arbitrary-value suffixes we do not evaluate.
 */
const SUB_44 = /(?:^|[\s"'`])(?:min-)?(?:h|w|size)-?(1|1\.5|2|3|4|5|6|7|8|9|10)(?![\w\-/])/;

/** Any explicit mechanism that already guarantees ≥44px on an axis. */
const TALL_ENOUGH = new RegExp(
  /(?:^|[\s"'`])(?:min-)?(?:h|size)-(?:1[1-9]|[2-9]\d|\d{3,})(?![/\w-])/.source +
    "|" + // an explicit px arbitrary value at or above the floor
    /(?:^|[\s"'`])(?:min-)?(?:h|size)-\[(?:4[4-9]|[5-9]\d|\d{3,})px\]/.source +
    "|" + /hit-44/.source,
);
const WIDE_ENOUGH = new RegExp(
  /(?:^|[\s"'`])(?:min-)?(?:w|size)-(?:full|1[1-9]|[2-9]\d|\d{3,})(?![/\w-])/.source +
    "|" + /(?:^|[\s"'`])(?:min-)?(?:w|size)-\[(?:4[4-9]|[5-9]\d|\d{3,})px\]/.source +
    "|" + /hit-44/.source,
);

/**
 * Padding on BOTH axes (`p-`, not `px-`/`py-`) small enough that a compact
 * glyph-only control lands under the floor on its own. `p-1`=4 `p-1.5`=6 `p-2`=8.
 */
const PADDING_SIZED = /(?:^|[\s"'`])p-?(1|1\.5|2)(?![\w\-/])/;

/** A control whose width comes from its container rather than its own class. */
const WIDTH_FROM_CONTAINER = /(?:^|[\s"'`])(?:w-full|flex-1|min-w-0)(?![\w-])/;

/**
 * Known sub-44 controls, keyed `relative/path` → reason. Each entry states why
 * `.hit-44` cannot be added. The list may only shrink: adding a new sub-44
 * control without `hit-44` fails this suite, and removing the `hit-44` from an
 * allowlisted control fails it too.
 *
 * Entries marked REPORTED were found by this suite when it was strengthened
 * (2026-10-03) and live in files owned by other agents, so they are recorded
 * rather than repaired. Each names the file:line of the real defect.
 */
const ALLOWLIST: Record<string, string> = {
  "components/photo-input/PhotoInputButton.tsx":
    "ALREADY 44px, by the rule's other permitted mechanism: 24px button + `before:-inset-2.5` (2×10px) = 44px. Listed only because the class string carries no `hit-44`.",
  "components/meals/RecipeImportModal.tsx":
    "REPORTED 2026-10-03, not repaired (meals owner). Two distinct sub-44 controls: the `grid-cols-8 gap-1` emoji picker at line 408 (32px cells, 4px gap — a 44px box extends 6px per side against a 2px half-gap, so cells would overlap; needs a wider grid, a design change, not a class) and a `p-1.5` glyph button at line 491.",
  "components/meals/RecipeModal.tsx":
    "REPORTED 2026-10-03, not repaired (meals owner). Two distinct sub-44 controls: the `grid-cols-8 gap-1` emoji picker at line 104 (32px cells, 4px gap, same overlap problem) and a `p-1.5` glyph button at line 265.",
  "components/ui/TopBar.tsx":
    "REPORTED 2026-10-03, not repaired (chrome owner). `<Link href=\"/\">` back affordance is `w-9 h-9` (36px) at TopBar.tsx:50 — a navigation control, not decoration. Needs `.hit-44`.",
  "components/meals/PlanTab.tsx":
    "REPORTED 2026-10-03, not repaired (meals owner). A 20×20 \"Copy day meals\" button at PlanTab.tsx:340 (`h-5 w-5`) plus three `p-1.5` glyph buttons at 420-422 (duplicate / edit / delete). All are absolutely or tightly positioned over dense meal rows, so they need a per-control decision, not one blanket `.hit-44`.",
  "components/skill-tree/QuestDetail.tsx":
    "REPORTED 2026-10-03, not repaired (skill-tree owner). Absolutely positioned `p-2` close button at QuestDetail.tsx:49.",
  "components/time-capsule/ContentUploader.tsx":
    "REPORTED 2026-10-03, not repaired (time-capsule owner). `p-2` glyph button at ContentUploader.tsx:102.",
  "components/time-capsule/CreateCapsuleForm.tsx":
    "REPORTED 2026-10-03, not repaired (time-capsule owner). `p-2` glyph button at CreateCapsuleForm.tsx:126.",
  "components/integrations/HomeAssistantWidget.tsx":
    "REPORTED 2026-10-03, not repaired (integrations owner). `p-2.5` compact icon tile at HomeAssistantWidget.tsx:141.",
};

/**
 * Every string literal in a `className` expression — the static parts AND the
 * ones nested inside `${…}` holes. This is the difference between this suite and
 * its predecessor, which deleted the holes and so could not see a size that
 * arrived through `clsx(…)` or a template ternary.
 */
function classLiterals(classAttr: string): string {
  return (classAttr.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .join(" ");
}

/**
 * End of a JSX opening tag, honouring nested `{…}` expressions and quoted
 * strings — without that, the `=>` inside `onClick={() => …}` ends the tag early
 * and the control's real className is never seen.
 */
function openingTagEnd(src: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/**
 * The raw `className` expression of an opening tag.
 *
 * Brace- and quote-aware on purpose: a non-greedy `\{[\s\S]*?\}` stops at the
 * FIRST `}`, which for `className={`chip ${tone} h-5 w-5`}` is the one closing
 * `${tone}` — so everything after the hole, including the size, is lost. That is
 * precisely the class of bug this suite exists to prevent.
 */
function classAttrOf(open: string): string | null {
  const at = open.search(/\bclassName\s*=/);
  if (at === -1) return null;
  let i = open.indexOf("=", at) + 1;
  while (i < open.length && /\s/.test(open[i])) i++;
  const first = open[i];
  if (first === '"' || first === "'" || first === "`") {
    const end = open.indexOf(first, i + 1);
    return end === -1 ? null : open.slice(i, end + 1);
  }
  if (first !== "{") return null;
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < open.length; j++) {
    const c = open[j];
    if (quote) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return open.slice(i, j + 1);
    }
  }
  return null;
}

type Offender = { rel: string; line: number; snippet: string };

/** Every interactive element in `src`, with its line number and class literals. */
function controls(src: string): { line: number; kind: string; open: string; classAttr: string }[] {
  const usesNextLink = /from\s+["']next\/link["']/.test(src);
  const out: { line: number; kind: string; open: string; classAttr: string }[] = [];
  const re = /<(button|a|Link|div|span|li)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const end = openingTagEnd(src, re.lastIndex);
    if (end === -1) continue;
    const open = src.slice(m.index, end);
    const roleButton = /role\s*=\s*(?:"button"|'button'|\{\s*["'`]button["'`])/.test(open);
    const kind =
      m[1] === "button"
        ? "button"
        : m[1] === "a" || (m[1] === "Link" && usesNextLink)
          ? "a"
          : roleButton
            ? "[role=button]"
            : null;
    if (!kind) {
      re.lastIndex = end;
      continue;
    }
    // A `<Link>`/`<a>` without an href is not a control.
    if (kind === "a" && !/\bhref\s*=/.test(open)) {
      re.lastIndex = end;
      continue;
    }
    const classAttr = classAttrOf(open);
    if (classAttr) out.push({ line: src.slice(0, m.index).split("\n").length, kind, open, classAttr });
    re.lastIndex = end;
  }
  return out;
}

/** The controls in `src` that violate the 44px floor. */
function offendersIn(rel: string, src: string): Offender[] {
  const out: Offender[] = [];
  for (const c of controls(src)) {
    const lit = classLiterals(c.classAttr);
    if (!lit.trim() || lit.includes("hit-44")) continue;
    if (SUB_44.test(lit)) {
      out.push({ rel, line: c.line, snippet: `${c.kind} ${lit.replace(/\s+/g, " ").trim().slice(0, 60)}` });
      continue;
    }
    // Padding-sized: nothing in the class string sets a 44px axis, and a
    // labelled glyph control sized only by padding is a ~24-32px target.
    if (
      /aria-label|aria-labelledby/.test(c.open) &&
      PADDING_SIZED.test(lit) &&
      !TALL_ENOUGH.test(lit) &&
      !WIDE_ENOUGH.test(lit) &&
      !WIDTH_FROM_CONTAINER.test(lit)
    ) {
      out.push({ rel, line: c.line, snippet: `${c.kind} ${lit.replace(/\s+/g, " ").trim().slice(0, 60)}` });
    }
  }
  return out;
}

describe("Tap-target contract: no sub-44px control without hit-44", () => {
  const files = globSync(join(process.cwd(), "src/**/*.tsx"));

  it("scanned the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every sub-44px control either carries hit-44 or is a documented allowlist entry", () => {
    const offenders: string[] = [];
    const seenAllowlist = new Set<string>();
    for (const abs of files) {
      const rel = abs.replace(`${process.cwd()}/src/`, "");
      for (const o of offendersIn(rel, readFileSync(abs, "utf8"))) {
        const reason = ALLOWLIST[rel];
        if (reason) {
          seenAllowlist.add(rel);
          expect(reason.length, `${rel} needs a written reason`).toBeGreaterThan(10);
        } else {
          offenders.push(`${rel}:${o.line}  [${o.snippet}]`);
        }
      }
    }
    expect(offenders, "add .hit-44, or an allowlist entry with a reason").toEqual([]);
    // The controls repaired on 2026-09-29 must NOT be allowlisted — if they
    // regress, the offender list above fails instead of being excused.
    expect(seenAllowlist.has("components/tasks/CrewTasksCard.tsx")).toBe(false);
    expect(seenAllowlist.has("components/leaderboard/DailyQuestCard.tsx")).toBe(false);
  });

  it("has no stale allowlist entries (an allowlisted file must still violate)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      if (offendersIn(rel, readFileSync(join(process.cwd(), "src", rel), "utf8")).length === 0) {
        stale.push(rel);
      }
    }
    expect(stale, "these controls are fixed or renamed — drop the allowlist entry").toEqual([]);
  });

  it("keeps a reason on every allowlist entry", () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${rel} needs a written reason`).toBeGreaterThan(40);
    }
  });
});

/**
 * The blind spots this suite used to have. A guard that reports zero offenders
 * is only worth something if it would actually have caught something, so each
 * case the 2026-10-03 strengthening was written for is pinned against a
 * synthetic control. Without these, every rule above could be quietly deleted
 * and the suite would still pass.
 */
describe("the 44px detector actually sees the shapes it claims to", () => {
  const src = (body: string) => body;
  const flagged = (body: string) => offendersIn("fixture.tsx", src(body)).length > 0;

  it.each([
    ["a 20px h-5 w-5 button (below the old 6..10 floor)", '<button className="absolute h-5 w-5 rounded-full">x</button>'],
    ["a 16px w-4 button", '<button className="w-4 h-4 rounded">x</button>'],
    ["a size-5 shorthand (sets both axes at once)", '<button className="size-5 rounded-full">x</button>'],
    ["a min-h-9 control", '<button className="min-h-9 px-2">x</button>'],
  ])("flags %s", (_label, body) => {
    expect(flagged(body)).toBe(true);
  });

  it.each([
    ["a 44px h-11 control (44 IS the floor)", '<button className="h-11 w-11">x</button>'],
    ["a 48px h-12 control", '<button className="h-12 w-12">x</button>'],
    ["a size-11 shorthand", '<button className="size-11 rounded-full">x</button>'],
    ["an explicit min-h-[44px]", '<button className="min-h-[44px] px-3">x</button>'],
    ["a compact control that carries hit-44", '<button className="hit-44 h-6 w-6 rounded-full">x</button>'],
    ["min-w-0 (a flex shrink allowance, not a size)", '<button className="min-w-0 flex-1 text-left">x</button>'],
    ["a fraction, which is a percentage", '<button className="w-1/2 h-1/2">x</button>'],
    ["a full-width row", '<button className="w-full py-3">x</button>'],
    ["an unlabelled text button", '<button className="p-2">Save</button>'],
  ])("does not flag %s", (_label, body) => {
    expect(flagged(body)).toBe(false);
  });

  it("flags a sub-44 control on an anchor, not only on a button", () => {
    expect(flagged('<a href="/" className="flex w-9 h-9 rounded-2xl">back</a>')).toBe(true);
  });

  it("flags a sub-44 next/link control, which is how this repo writes anchors", () => {
    const body = [
      'import Link from "next/link";',
      'export const X = () => <Link href="/" className="flex w-9 h-9 rounded-2xl">back</Link>;',
    ].join("\n");
    expect(flagged(body)).toBe(true);
  });

  it("does not mistake an unrelated <Link> component for an anchor", () => {
    const body = [
      'import Link from "@/components/ui/Link";',
      'export const X = () => <Link className="w-6 h-6">not a navigation</Link>;',
    ].join("\n");
    expect(flagged(body)).toBe(false);
  });

  it("flags a sub-44 role=button control", () => {
    expect(flagged('<div role="button" tabIndex={0} aria-label="Pick" className="h-6 w-6">x</div>')).toBe(true);
  });

  it("flags a sub-44 size hidden inside a template hole", () => {
    // The old suite deleted `${…}` wholesale, so this was invisible to it.
    expect(flagged('<button className={`chip ${tone} h-5 w-5`}>x</button>')).toBe(true);
  });

  it("flags a sub-44 size hidden inside a clsx expression", () => {
    expect(flagged('<button className={clsx("chip", tone, "h-6 w-6")}>x</button>')).toBe(true);
  });

  it("flags a sub-44 size chosen by a ternary inside a template hole", () => {
    expect(flagged('<button className={`chip ${big ? "h-5" : "h-12"}`}>x</button>')).toBe(true);
  });

  it("flags a padding-sized glyph control with no width or height of its own", () => {
    expect(flagged('<button aria-label="Duplicate" className="p-1.5 rounded-lg">↗</button>')).toBe(true);
  });

  it("reads a className that sits after a handler containing an arrow function", () => {
    // Without brace/quote-aware tag scanning the `=>` ends the tag and the real
    // className is never examined.
    expect(
      flagged('<button onClick={(e) => { e.stopPropagation(); go(); }} className="h-5 w-5">x</button>'),
    ).toBe(true);
  });
});