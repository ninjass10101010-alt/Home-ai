// @vitest-environment jsdom
// Operate-mode a11y/legibility fixes for the Tasks feature's own components
// (DueDatePicker, CrewTasksCard, TasksRewardsPanel, TasksArchive,
// TaskLedgerQuarantineNotice, TasksStats).
//
// Two rules shape every assertion here:
//
//  1. COLOUR IS A MEASUREMENT, NOT A CLASS NAME. Finding A was "the selected
//     day is effectively invisible" with two numbers attached (1.06:1 fill,
//     3.36:1 ink). A test that only asserts `className` contains a token would
//     pass on a recipe that measures 1.5:1, so the colour test resolves the real
//     `src/app/globals.css` token cascade for every (theme x accent) pair and
//     computes WCAG 2.2 contrast — the same model
//     `tests/unit/theme-token-contrast.test.ts` uses, trimmed to the four tokens
//     this surface reads. `src/modes/modes.css` is deliberately not read: kid and
//     bedtime modes swap the canvas underneath, and the family theme is the one
//     this control is claimed to hold in.
//
//  2. NO @testing-library IN THIS REPO. `createRoot` + `act`, clicking via
//     `.click()`, queries from `document.body` (the calendar is a house `Modal`,
//     which portals). jsdom reports 0x0 rects, so every size assertion reads the
//     class string — the house idiom locked by `tap-target-contract.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import CrewTasksCard from "@/components/tasks/CrewTasksCard";
import DueDatePicker from "@/components/tasks/DueDatePicker";
import TaskLedgerQuarantineNotice from "@/components/tasks/TaskLedgerQuarantineNotice";
import TasksArchive from "@/components/tasks/TasksArchive";
import TasksRewardsPanel from "@/components/tasks/TasksRewardsPanel";
import TasksStats from "@/components/tasks/TasksStats";
import type { Penalty, Reward, Task, Transaction, WeekData } from "@/types/tasks";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The house Modal's enter/exit phases read matchMedia; absent in jsdom. Same
// stub idiom as due-date-picker.test.tsx.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
}));

/* ─────────────────────── colour token resolution ─────────────────────── */

const ACCENTS = ["nori", "violet", "rose", "coral", "lavender", "cyan", "mint", "amber", "apricot", "sage"] as const;
type Accent = (typeof ACCENTS)[number];

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

/**
 * Every `--token: value` pair declared for `<html>` in a given context, as the
 * browser would cascade it: `@theme` first (Tailwind's emitted `:root`), then
 * each plain `:root`, then the accent and theme attribute blocks. Both
 * attribute blocks are specificity (0,2,0) and the theme block is later in the
 * file, which is exactly the real order in `globals.css`.
 */
function declarations(theme: "light" | "dark", accent: Accent): Map<string, string> {
  const out = new Map<string, string>();
  const take = (src: string, into: Map<string, string>) => {
    for (const decl of src.split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim();
      if (prop.startsWith("--")) into.set(prop, decl.slice(at + 1).trim());
    }
  };
  const blocks = [...CSS.matchAll(/(@theme|:root(?:\[[^\]]*\])?)\s*\{([^}]*)\}/g)];
  for (const [, selector, body] of blocks) {
    const sel = selector.trim();
    const applies = sel === "@theme"
      || sel === ":root"
      || sel === `:root[data-accent="${accent}"]`
      || (theme === "light" && sel === ':root[data-theme="light"]');
    if (applies) take(body, out);
  }
  return out;
}

function splitTopLevel(input: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** `var()` substitution at computed-value time and premultiplied `color-mix()`. */
function evaluate(expr: string, ctx: Map<string, string>, seen: string[] = []): Rgba {
  const value = expr.trim();
  if (value.startsWith("color-mix(")) {
    const operands = splitTopLevel(value.slice("color-mix(".length, value.lastIndexOf(")")), ",").slice(1);
    const percent = (part: string) => {
      const m = part.match(/([\d.]+)%\s*$/);
      return m ? Number(m[1]) / 100 : null;
    };
    const [left, right] = operands;
    const p1 = percent(left);
    const p2 = percent(right);
    const c1 = evaluate(left.replace(/[\d.]+%\s*$/, ""), ctx, seen);
    const c2 = evaluate(right.replace(/[\d.]+%\s*$/, ""), ctx, seen);
    const t1 = p1 === null && p2 === null ? 0.5 : p1 ?? 1 - (p2 as number);
    const t2 = p2 === null && p1 === null ? 0.5 : p2 ?? 1 - t1;
    const a1 = t1 * c1[3];
    const a2 = t2 * c2[3];
    const alpha = a1 + a2;
    if (alpha === 0) return [0, 0, 0, 0];
    return [
      (a1 * c1[0] + a2 * c2[0]) / alpha,
      (a1 * c1[1] + a2 * c2[1]) / alpha,
      (a1 * c1[2] + a2 * c2[2]) / alpha,
      alpha,
    ];
  }
  const ref = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (ref) {
    if (seen.includes(ref[1])) throw new Error(`custom-property cycle: ${[...seen, ref[1]].join(" -> ")}`);
    const raw = ctx.get(ref[1]);
    if (raw === undefined) throw new Error(`${ref[1]} is not assigned in globals.css for this context`);
    return evaluate(raw, ctx, [...seen, ref[1]]);
  }
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
  }
  if (value === "white") return [255, 255, 255, 1];
  if (value === "black") return [0, 0, 0, 1];
  if (value === "transparent") return [0, 0, 0, 0];
  throw new Error(`unsupported colour value: ${value}`);
}

const tokenCache = new Map<string, Map<string, string>>();

/** The resolved custom property in one (theme, accent) context. */
function token(name: string, theme: "light" | "dark", accent: Accent): Rgba {
  const key = `${theme}/${accent}`;
  let decls = tokenCache.get(key);
  if (!decls) {
    decls = declarations(theme, accent);
    tokenCache.set(key, decls);
  }
  const raw = decls.get(name);
  if (raw === undefined) throw new Error(`${name} is not assigned in globals.css for ${theme}/${accent}`);
  return evaluate(raw, decls);
}

const over = (fg: Rgba, bg: Rgb): Rgb => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
];

function luminance(rgb: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(fg: Rgba, bg: Rgb): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ─────────────────────────── render helpers ─────────────────────────── */

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(ui);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return el;
}

async function settle(ms = 200) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function click(el: Element | null) {
  expect(el, "element to click").not.toBeNull();
  act(() => {
    (el as HTMLElement).click();
  });
}

function byLabel<T extends Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

function buttonWithText(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => (b.textContent || "").trim() === text,
  );
  expect(found, `button "${text}"`).toBeTruthy();
  return found as HTMLButtonElement;
}

/** React's duplicate-key warning, which is console.error'd in dev. */
let consoleErrors: unknown[][] = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  consoleErrors = [];
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const duplicateKeyWarnings = () =>
  consoleErrors.filter((args) => /unique "key"|same key/i.test(args.map(String).join(" ")));

/* ══════════════════════════════ DueDatePicker ═══════════════════════════ */

const NO_DUE_LABEL = "No due date";

function openCalendar(value: string): HTMLElement {
  render(<DueDatePicker value={value} onChange={vi.fn()} />);
  click(byLabel<HTMLButtonElement>(`[aria-label^="Choose due date"]`));
  return document.body;
}

/** Day cells, found by the machine-readable `data-date` hook. */
function dayCells(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[data-date]"));
}

describe("DueDatePicker — the selected day must be visible (finding A)", () => {
  it("the selected cell is painted with a real token fill and AA ink, not the 1.06:1 surface tint", () => {
    const value = "2026-10-05";
    openCalendar(value);

    const selected = document.body.querySelector<HTMLButtonElement>(`button[data-date="${value}"]`);
    expect(selected, "the selected day cell").not.toBeNull();

    // The old recipe: `--color-surface-2` fill on a `--color-surface-1` panel
    // (1.06:1 in light) and `--color-accent-mint` ink (3.36:1). Neither may
    // survive, in either role.
    expect(selected!.className).not.toContain("var(--color-surface-2)");
    expect(selected!.className).not.toContain("var(--color-accent-mint)");
    expect(selected!.className, "a real accent fill").toMatch(/var\(--color-accent-[a-z-]+\)/);
    expect(selected!.className, "AA ink on that fill").toMatch(/var\(--color-(accent|text)-[a-z-]+\)/);
    expect(selected!.className, "weight is still part of the signal").toContain("font-semibold");
  });

  it("white ink on the selected fill clears AA body contrast for EVERY accent in BOTH themes", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const accent of ACCENTS) {
        const fill = token("--color-accent-button", theme, accent);
        const ink = token("--color-text-on-accent", theme, accent);
        const ratio = contrast(ink, [fill[0], fill[1], fill[2]]);
        expect(ratio, `${theme}/${accent} ink on the selected fill`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the reported LIGHT measurements (1.06:1 fill, 3.36:1 ink) really were below the floor", () => {
    // A guard on the guard. If the light tokens ever drifted so the old recipe
    // measured well, this assertion would be meaningless — so the numbers the
    // finding quotes are pinned, not taken on trust. (Dark measured 9.01:1 for
    // the ink, which is why this was only ever a light-theme defect.)
    const mint = token("--color-accent-mint", "light", "nori");
    const surface = token("--color-surface-2", "light", "nori");
    const panel = token("--color-surface-1", "light", "nori");
    expect(contrast(mint, [surface[0], surface[1], surface[2]]), "old ink").toBeLessThan(4.5);
    expect(contrast(surface, [panel[0], panel[1], panel[2]]), "old fill").toBeLessThan(1.5);
  });

  it("an unselected in-month day carries NO fill, so selection is a shape difference, not just weight", () => {
    openCalendar("2026-10-05");
    const other = document.body.querySelector<HTMLButtonElement>('button[data-date="2026-10-14"]')!;
    const selected = document.body.querySelector<HTMLButtonElement>('button[data-date="2026-10-05"]')!;
    expect(other.className).not.toMatch(/bg-\[/);
    expect(selected.className).toMatch(/bg-\[/);
    expect(other.getAttribute("aria-pressed")).toBe("false");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("DueDatePicker — a due date must be clearable (finding B)", () => {
  it("the 'No due date' control calls onChange with the empty string", () => {
    const onChange = vi.fn();
    render(<DueDatePicker value="2026-10-05" onChange={onChange} />);
    click(byLabel<HTMLButtonElement>(`[aria-label="${NO_DUE_LABEL}"]`));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("that control reaches the 44px floor and announces whether it is the current state", () => {
    render(<DueDatePicker value="2026-10-05" onChange={vi.fn()} />);
    const clear = byLabel<HTMLButtonElement>(`[aria-label="${NO_DUE_LABEL}"]`);
    expect(clear, "a control labelled 'No due date'").not.toBeNull();
    // jsdom reports 0x0 rects, so the class string is the measurement (the
    // house idiom locked by tap-target-contract.test.ts).
    expect(clear!.className, "44px hit area").toMatch(/hit-44|min-h-\[44px\]/);
    expect(clear!.getAttribute("aria-pressed"), "reads as selected when there is no date").toBe("false");

    const without = render(<DueDatePicker value="" onChange={vi.fn()} />);
    const pressed = without.querySelector<HTMLButtonElement>(`[aria-label="${NO_DUE_LABEL}"]`);
    expect(pressed!.getAttribute("aria-pressed")).toBe("true");
  });

  it("the clear control is visually distinct from the day presets", () => {
    const host = render(<DueDatePicker value="" onChange={vi.fn()} />);
    const clear = host.querySelector<HTMLButtonElement>(`[aria-label="${NO_DUE_LABEL}"]`)!;
    const today = buttonWithText("Today");
    expect(clear.className).not.toBe(today.className);
    // A selected state, so "no date" is legible at a glance rather than only
    // through the trigger's wording.
    expect(clear.className).toMatch(/var\(--color-accent-|chip-selected/);
  });
});

describe("DueDatePicker — 'Next week' must mean next week (finding C)", () => {
  it.each([
    ["Monday", "2026-10-05T09:00:00", "2026-10-12"],
    ["Tuesday", "2026-10-06T09:00:00", "2026-10-12"],
    ["Sunday", "2026-10-11T09:00:00", "2026-10-12"],
  ])("from a %s, 'Next week' is the next MONDAY, not +6 days", (_day, now, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const onChange = vi.fn();
    render(<DueDatePicker value="" onChange={onChange} />);
    click(buttonWithText("Next week"));
    expect(onChange).toHaveBeenCalledWith(expected);
    vi.useRealTimers();
  });

  it("from a Monday the old +6 reading would be the coming Sunday — the day the fix exists for", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T09:00:00"));
    const d = new Date();
    d.setDate(d.getDate() + 6);
    const sixDaysOut = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(new Date(`${sixDaysOut}T12:00:00`).getDay(), "the old value was a Sunday").toBe(0);
    expect(sixDaysOut, "six days that are still THIS week").toBe("2026-10-11");
    vi.useRealTimers();
  });

  it("no two controls in the row share a name", () => {
    const host = render(<DueDatePicker value="" onChange={vi.fn()} />);
    const labels = Array.from(host.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
    expect(new Set(labels).size, `duplicated control names: ${labels.join(" | ")}`).toBe(labels.length);
  });
});

describe("DueDatePicker — the calendar is one tab stop with real semantics (finding D)", () => {
  it("exposes grid semantics named by the visible month", () => {
    openCalendar("2026-10-05");
    const grid = document.body.querySelector('[role="grid"]');
    expect(grid, "the calendar is a grid").not.toBeNull();
    const labelledBy = grid!.getAttribute("aria-labelledby");
    expect(labelledBy, "the grid names its month").toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading?.textContent).toBe("October 2026");
  });

  it("the weekday row is real column headers, not bare spans in the day grid", () => {
    openCalendar("2026-10-05");
    const headers = Array.from(document.body.querySelectorAll("th"));
    expect(headers).toHaveLength(7);
    expect(headers.map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    for (const h of headers) expect(h.getAttribute("scope")).toBe("col");
  });

  it("announces human dates, never a raw ISO string", () => {
    openCalendar("2026-10-05");
    const cells = dayCells();
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const label = cell.getAttribute("aria-label") || "";
      expect(label, "not a raw ISO string").not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(label).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /);
    }
    // The machine-readable value is still reachable for code, just not announced.
    expect(document.body.querySelector('button[data-date="2026-10-05"]')).not.toBeNull();
  });

  it("is a SINGLE tab stop: exactly one day cell is in the tab order", () => {
    openCalendar("2026-10-05");
    const tabbable = dayCells().filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("data-date")).toBe("2026-10-05");
    for (const cell of dayCells().filter((c) => c !== tabbable[0])) {
      expect(cell.getAttribute("tabindex"), "every other day is -1").toBe("-1");
    }
  });

  it("arrow keys move the focus and keep exactly one cell in the tab order", () => {
    openCalendar("2026-10-05");
    const first = document.body.querySelector<HTMLButtonElement>('button[data-date="2026-10-05"]')!;
    first.focus();
    expect(document.activeElement).toBe(first);

    act(() => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect((document.activeElement as HTMLElement)?.dataset?.date).toBe("2026-10-06");

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect((document.activeElement as HTMLElement)?.dataset?.date).toBe("2026-10-13");

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect((document.activeElement as HTMLElement)?.dataset?.date).toBe("2026-10-12");

    expect(dayCells().filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect((document.activeElement as HTMLElement).getAttribute("tabindex")).toBe("0");
  });

  it("arrow keys walk off the end of the month into the next one instead of dead-ending", () => {
    openCalendar("2026-10-31");
    const last = document.body.querySelector<HTMLButtonElement>('button[data-date="2026-10-31"]')!;
    last.focus();
    act(() => {
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect((document.activeElement as HTMLElement)?.dataset?.date).toBe("2026-11-01");
    expect(document.body.textContent).toContain("November 2026");
    expect(dayCells().filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("a 5-row month renders 5 rows, not a phantom 6th week", () => {
    // October 2026: the 1st is a Thursday, so 3 leading + 31 days = 34 cells,
    // which is exactly five Monday-first rows.
    openCalendar("2026-10-05");
    expect(dayCells()).toHaveLength(35);
    const rows = document.body.querySelectorAll('[role="grid"] [role="row"]');
    expect(rows).toHaveLength(6); // one header row + five week rows
    expect(dayCells().at(-1)?.getAttribute("data-date")).toBe("2026-11-01");
  });

  it("a 6-row month still renders all 42 days", () => {
    // August 2026: the 1st is a Saturday, so 5 leading + 31 = 36 cells -> 6 rows.
    openCalendar("2026-08-01");
    expect(dayCells()).toHaveLength(42);
  });
});

/* ══════════════════════════════ TasksArchive ═════════════════════════════ */

const WEEK: WeekData = {
  weekStart: "2026-10-05",
  points: {},
  streak: {},
  lastActive: {},
  history: [],
};

type ArchiveProps = React.ComponentProps<typeof TasksArchive>;

function archiveProps(over: Partial<ArchiveProps> = {}): ArchiveProps {
  return {
    weekData: WEEK,
    tasks: [],
    currentUser: null,
    isLoggedIn: false,
    leaderboard: [],
    memberColors: {},
    isParent: true,
    allTimePoints: undefined,
    allTimeCompletions: undefined,
    ...over,
  };
}

describe("TasksArchive — the disclosure must be openable (finding E)", () => {
  it("is a real control with a ≥44px box and a reported expanded state", async () => {
    const host = render(<TasksArchive {...archiveProps()} />);
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="archive-disclosure"]');
    expect(toggle, "an explicit disclosure control").not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded"), "collapsed at rest").toBe("false");
    expect(toggle!.getAttribute("aria-controls"), "pointed at the panel it opens").toBeTruthy();
    // The old shape put `py-3` on the <details> container, so the summary's own
    // hit box was one 20px text line — and the tap-target scan never looks at
    // <summary> at all.
    expect(toggle!.className, "44px hit area").toMatch(/hit-44|min-h-\[44px\]/);

    click(toggle);
    // `useId` emits `:r…:`, which is a legal id but not a legal CSS selector.
    const panel = document.getElementById(toggle!.getAttribute("aria-controls")!);
    expect(panel, "the panel it controls").not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded"), "expanded after one tap").toBe("true");
    await settle();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses again, and the state is never decorative", async () => {
    const host = render(<TasksArchive {...archiveProps()} />);
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="archive-disclosure"]')!;
    click(toggle);
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeNull();
    await settle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("TasksArchive — a parent-typed reason is attributed, not broadcast inline (finding F)", () => {
  const REASON = "took it back after you were mean to your sister";

  function historyWithReason(): WeekData {
    return {
      ...WEEK,
      history: [
        {
          id: 91,
          timestamp: "2026-10-06T19:04:00.000Z",
          member: "Alex Garcia",
          type: "adjust",
          amount: -10,
          // The stored shape `task-ledger-command.ts` writes — NOT changed here.
          description: `Manual adjust: -10pts (${REASON})`,
        } satisfies Transaction,
      ],
    };
  }

  it("keeps the parent's words OUT of the transaction sentence", () => {
    const host = render(<TasksArchive {...archiveProps({ weekData: historyWithReason() })} />);
    const sentence = host.querySelector('[data-testid="ledger-tx-description"]')!;
    expect(sentence.textContent).not.toContain(REASON);
    expect(sentence.textContent).toContain("Manual adjust: -10pts");
  });

  it("renders the reason as a quoted, attributed note instead", () => {
    const host = render(<TasksArchive {...archiveProps({ weekData: historyWithReason() })} />);
    const note = host.querySelector('[data-testid="ledger-tx-reason"]')!;
    expect(note, "a reason sub-line").not.toBeNull();
    expect(note.textContent).toContain(REASON);
    expect(note.textContent, "attributed to a parent").toMatch(/parent/i);
    expect(note.textContent!.trim(), "quoted, so it is never read as the ledger's own sentence").toMatch(/^[“"]/);
    // The amount is still the family's money history and must survive.
    expect(host.textContent).toContain("-10");
  });

  it("an entry with no reason grows no note — the sub-line is not chrome", () => {
    const week: WeekData = {
      ...WEEK,
      history: [
        {
          id: 92,
          timestamp: "2026-10-06T19:04:00.000Z",
          member: "Alex Garcia",
          type: "adjust",
          amount: 5,
          description: "Manual adjust: +5pts",
        } satisfies Transaction,
      ],
    };
    const host = render(<TasksArchive {...archiveProps({ weekData: week })} />);
    expect(host.querySelector('[data-testid="ledger-tx-reason"]')).toBeNull();
  });

  it("a reason that itself contains a parenthesis round-trips whole", () => {
    const reason = "bedtime moved (again)";
    const week: WeekData = {
      ...WEEK,
      history: [
        {
          id: 93,
          timestamp: "2026-10-06T19:04:00.000Z",
          member: "Alex Garcia",
          type: "adjust",
          amount: -5,
          description: `Manual adjust: -5pts (${reason})`,
        } satisfies Transaction,
      ],
    };
    const host = render(<TasksArchive {...archiveProps({ weekData: week })} />);
    expect(host.querySelector('[data-testid="ledger-tx-reason"]')!.textContent).toContain(`“${reason}”`);
    expect(host.querySelector('[data-testid="ledger-tx-description"]')!.textContent).toBe("Manual adjust: -5pts");
  });

  it("a penalty row's own '(-Npts)' is not mistaken for a parent note", () => {
    const week: WeekData = {
      ...WEEK,
      history: [
        {
          id: 94,
          timestamp: "2026-10-06T19:04:00.000Z",
          member: "Alex Garcia",
          type: "penalty",
          amount: -5,
          description: "Penalty: Skipped trash (-5pts)",
        } satisfies Transaction,
      ],
    };
    const host = render(<TasksArchive {...archiveProps({ weekData: week })} />);
    expect(host.querySelector('[data-testid="ledger-tx-description"]')!.textContent)
      .toBe("Penalty: Skipped trash (-5pts)");
    expect(host.querySelector('[data-testid="ledger-tx-reason"]')).toBeNull();
  });
});

/* ═══════════════════════════ TasksRewardsPanel ═══════════════════════════ */

const REWARDS: Reward[] = [
  { id: 1, name: "Ice cream", emoji: "🍦", cost: 20 },
  { id: 2, name: "Movie night", emoji: "🎬", cost: 150 },
];
const PENALTIES: Penalty[] = [{ id: 7, name: "Skipped trash", emoji: "⚠️", points: 5 }];

function rewardHandlers() {
  return {
    onGenerateAi: vi.fn(),
    onAdd: vi.fn(),
    onAdopt: vi.fn(),
    onRedeem: vi.fn(),
    onEdit: vi.fn(),
    onAddPenalty: vi.fn(),
    onApplyPenalty: vi.fn(),
    onEditPenalty: vi.fn(),
  };
}

describe("TasksRewardsPanel — the penalty action must not look like its own label (finding G)", () => {
  it("is a distinct glyph in a danger tone, not a second ⚠️", () => {
    const host = render(<TasksRewardsPanel {...rewardHandlers()} rewards={REWARDS} aiRewards={[]} aiRewardSuggesting={false} penalties={PENALTIES} />);
    const apply = host.querySelector<HTMLButtonElement>('[aria-label="Apply penalty"]')!;
    expect(apply).not.toBeNull();

    // `startAddPenalty` seeds emoji "⚠️", so the seeded row read ⚠️ ⚠️ ✎.
    const penaltyEmoji = PENALTIES[0].emoji;
    expect(apply.textContent, "the apply glyph is not the penalty's own emoji").not.toBe(penaltyEmoji);
    expect(apply.textContent!.trim().length, "a glyph, not an empty button").toBeGreaterThan(0);

    // Colour-coded like every other danger control in the system.
    expect(apply.className).toContain("var(--color-accent-rose)");
    const edit = host.querySelector<HTMLButtonElement>('[aria-label="Edit penalty"]')!;
    expect(edit.className, "edit is NOT the destructive tone").not.toContain("var(--color-accent-rose)");
  });

  it("still carries the aria-label the rest of the app clicks on", () => {
    const host = render(<TasksRewardsPanel {...rewardHandlers()} rewards={REWARDS} aiRewards={[]} aiRewardSuggesting={false} penalties={PENALTIES} />);
    // tasks-pin-error-paths / tasks-outbox-commands query these exact strings.
    expect(host.querySelector('[aria-label="Apply penalty"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Edit penalty"]')).not.toBeNull();
  });
});

describe("TasksRewardsPanel — AI suggestions must not collide by name (finding H)", () => {
  it("two same-named suggestions render as two cards, with no duplicate-key warning", () => {
    const ideas: Reward[] = [
      { id: 1001, name: "Movie night", emoji: "🎬", cost: 50 },
      { id: 1002, name: "Movie night", emoji: "🍿", cost: 60 },
    ];
    const host = render(
      <TasksRewardsPanel {...rewardHandlers()} rewards={[]} aiRewards={ideas} aiRewardSuggesting={false} penalties={[]} />,
    );
    expect(duplicateKeyWarnings(), `React said: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    const cards = Array.from(host.querySelectorAll("*")).filter((n) => n.textContent === "Movie night");
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("one suggestion still renders exactly once", () => {
    const host = render(
      <TasksRewardsPanel
        {...rewardHandlers()}
        rewards={[]}
        aiRewards={[{ id: 1001, name: "Movie night", emoji: "🎬", cost: 50 }]}
        aiRewardSuggesting={false}
        penalties={[]}
      />,
    );
    expect(duplicateKeyWarnings()).toEqual([]);
    expect(host.textContent).toContain("Movie night");
  });
});

describe("TasksRewardsPanel — the admin gate (finding I)", () => {
  const base = { rewards: REWARDS, aiRewards: [] as Reward[], aiRewardSuggesting: false, penalties: PENALTIES };

  it("with canManage false, no admin control is rendered — and redeem still is", () => {
    const handlers = rewardHandlers();
    const host = render(<TasksRewardsPanel {...base} {...handlers} canManage={false} />);
    for (const label of ["Edit reward", "Apply penalty", "Edit penalty"]) {
      expect(host.querySelector(`[aria-label="${label}"]`), `${label} is admin-only`).toBeNull();
    }
    expect(buttonText(host, "Suggest"), "the AI-suggestion trigger is admin-only").toBeNull();
    expect(buttonText(host, "Add"), "the reward / penalty Add buttons are admin-only").toBeNull();
    expect(host.textContent).not.toContain("Point deductions for missed chores");
    // The rewards CATALOGUE stays: redeeming is a member action.
    expect(host.textContent).toContain("Spend points on family perks");
    expect(host.textContent).toContain("Ice cream");

    const redeem = buttonText(host, "Redeem");
    expect(redeem, "redeeming is a member action").not.toBeNull();
    click(redeem);
    expect(handlers.onRedeem).toHaveBeenCalledWith(REWARDS[0]);
  });

  it("with canManage true, every control today's page passes is rendered", () => {
    const host = render(<TasksRewardsPanel {...base} {...rewardHandlers()} canManage />);
    for (const label of ["Edit reward", "Apply penalty", "Edit penalty"]) {
      expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(buttonText(host, "Suggest")).not.toBeNull();
    expect(buttonText(host, "Add")).not.toBeNull();
    expect(buttonText(host, "Redeem")).not.toBeNull();
    expect(host.textContent).toContain("Point deductions for missed chores");
  });

  it("the prop is OPTIONAL and defaults to today's behaviour, so a mid-edit call site still works", () => {
    const host = render(<TasksRewardsPanel {...base} {...rewardHandlers()} />);
    for (const label of ["Edit reward", "Apply penalty", "Edit penalty"]) {
      expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(buttonText(host, "Suggest")).not.toBeNull();
    expect(host.textContent).toContain("Spend points on family perks");
  });
});

function buttonText(root: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => (b.textContent || "").trim() === text,
  ) ?? null;
}

/* ══════════════════════════════ CrewTasksCard ════════════════════════════ */

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

function crewTask(members: Array<{ name: string; emoji: string; checkedInAt?: string }>): Task {
  return {
    id: 42,
    title: "Bake cookies",
    points: 5,
    crew: {
      size: 2,
      members: members.map((m, i) => ({
        name: m.name,
        emoji: m.emoji,
        joinedAt: `2026-10-05T10:0${i}:00.000Z`,
        ...(m.checkedInAt ? { checkedInAt: m.checkedInAt } : {}),
      })),
      removedMembers: [],
    },
    crewSize: 2,
    completed: false,
    pendingApproval: false,
  } as unknown as Task;
}

describe("CrewTasksCard — a member's name is announced once (finding J)", () => {
  it("hides the photo avatar from assistive tech, leaving the visible name as the only name", () => {
    const host = render(
      <CrewTasksCard tasks={[crewTask([{ name: "Emily Garcia", emoji: PHOTO }])]} visible onRemoveMember={vi.fn()} onCloseCrew={vi.fn()} />,
    );
    const img = host.querySelector("img")!;
    expect(img, "the photo still renders").not.toBeNull();
    expect(img.getAttribute("alt"), "a decorative avatar beside a visible name carries no alt").toBe("");
    expect(img.closest('[aria-hidden="true"]'), "and the whole glyph slot is hidden").not.toBeNull();
  });

  it("hides a plain emoji glyph too — it is decoration next to the name", () => {
    const host = render(
      <CrewTasksCard tasks={[crewTask([{ name: "Alex Garcia", emoji: "🧒" }])]} visible onRemoveMember={vi.fn()} onCloseCrew={vi.fn()} />,
    );
    expect(host.textContent).toContain("🧒");
    expect(host.querySelector('[aria-hidden="true"]'), "the glyph slot is hidden").not.toBeNull();
  });

  it("speaks the first name exactly once per chip", () => {
    const host = render(
      <CrewTasksCard tasks={[crewTask([{ name: "Emily Garcia", emoji: PHOTO }])]} visible onRemoveMember={vi.fn()} onCloseCrew={vi.fn()} />,
    );
    const chip = host.querySelector('[data-testid="crew-member-chip"]')!;
    expect(chip).not.toBeNull();
    const occurrences = (chip.textContent!.match(/Emily/g) || []).length;
    expect(occurrences, `chip text: ${chip.textContent}`).toBe(1);
  });

  it("two crew members with the same name produce no duplicate React key", () => {
    render(
      <CrewTasksCard
        tasks={[crewTask([{ name: "Alex Garcia", emoji: "🧒" }, { name: "Alex Garcia", emoji: "🧑" }])]}
        visible
        onRemoveMember={vi.fn()}
        onCloseCrew={vi.fn()}
      />,
    );
    expect(duplicateKeyWarnings(), `React said: ${JSON.stringify(consoleErrors)}`).toEqual([]);
  });
});

/* ═══════════════ TaskLedgerQuarantineNotice (honest state, finding K) ═════ */

const NOTICE_TESTID = "task-ledger-quarantine-notice";

const LOCAL_WEEK: WeekData = {
  weekStart: "2026-10-05",
  points: {},
  streak: {},
  lastActive: {},
  history: [
    { id: 7, timestamp: "2026-10-05T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "Completed: Dishes" },
  ],
};

function quarantineReport(over: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    generatedAt: "2026-10-06T12:00:00.000Z",
    localWeekStart: "2026-10-05",
    canonicalWeekStart: "2026-10-05",
    exactMatches: [],
    semanticMatches: [],
    quarantined: [
      { id: 101, timestamp: "2026-10-05T11:00:00.000Z", member: "Alex", type: "penalty" as const, amount: -5, description: "Penalty: Trash" },
    ],
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("TaskLedgerQuarantineNotice — the claim needs a REAL canonical week (finding K)", () => {
  it("never renders the claim on the 409 canonical_week_unknown refusal", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "canonical_week_unknown", canonicalWeekStart: null }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const el = await renderAsync(<TaskLedgerQuarantineNotice localWeekData={LOCAL_WEEK} isParent />);
    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
    expect(el.textContent).not.toContain("not on the server");
  });

  it("never renders it when a 200 report carries a NULL canonical week — an unknown is not a fabricated zero", async () => {
    // The route agent's own note: "a future 200-with-empty-report here would
    // silently restore the false claim". The client is the second gate.
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, mode: "dry-run", report: quarantineReport({ canonicalWeekStart: null }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = await renderAsync(<TaskLedgerQuarantineNotice localWeekData={LOCAL_WEEK} isParent />);
    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
    expect(el.textContent).not.toContain("not on the server");
  });

  it("never renders it when the canonical week key is not a real calendar week", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, mode: "dry-run", report: quarantineReport({ canonicalWeekStart: "2026-13-45" }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = await renderAsync(<TaskLedgerQuarantineNotice localWeekData={LOCAL_WEEK} isParent />);
    expect(el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)).toBeNull();
  });

  it("DOES render it against a real canonical week with unmatched rows", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, mode: "dry-run", report: quarantineReport() }));
    vi.stubGlobal("fetch", fetchMock);
    const el = await renderAsync(<TaskLedgerQuarantineNotice localWeekData={LOCAL_WEEK} isParent />);
    const notice = el.querySelector(`[data-testid="${NOTICE_TESTID}"]`);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("1");
    expect(notice!.textContent).toContain("not on the server");
  });

  it("an unknown week on the EXPORT leg is reported as unknown, not as a failed write", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) =>
      JSON.parse(init.body).mode === "export"
        ? jsonResponse({ error: "canonical_week_unknown", canonicalWeekStart: null }, 409)
        : jsonResponse({ ok: true, mode: "dry-run", report: quarantineReport() }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = await renderAsync(<TaskLedgerQuarantineNotice localWeekData={LOCAL_WEEK} isParent />);
    const exportButton = el.querySelector<HTMLButtonElement>('[aria-label="Export unmatched local ledger rows"]')!;
    click(exportButton);
    await settle();
    const notice = el.querySelector(`[data-testid="${NOTICE_TESTID}"]`)!;
    expect(notice.textContent).toMatch(/couldn.t confirm this week|could not confirm this week/i);
    expect(notice.textContent, "never dressed up as a successful write").not.toMatch(/saved to/i);
    expect(localStorage.getItem("consuela-ledger-quarantine-handled-v1"), "not marked handled").toBeNull();
  });
});

/* ═══════════════════════════════ TasksStats ══════════════════════════════ */

describe("TasksStats — the stat row stays honest (finding L)", () => {
  it("renders an unreadable all-time total as the word 'unavailable', never a shortened number", () => {
    const host = render(
      <TasksStats
        pendingCount={3}
        completedCount={7}
        earnedThisWeek={42}
        allTimePoints={null}
        allTimeRead={{ state: "authoritative", updatedAt: null }}
        activeTab="tasks"
        onChange={vi.fn()}
      />,
    );
    expect(host.textContent).toContain("unavailable");
    expect(host.textContent).not.toContain("0 pts all-time");
  });

  it("does not duplicate the page's sync / retry / queue counts", () => {
    const host = render(
      <TasksStats
        pendingCount={3}
        completedCount={7}
        earnedThisWeek={42}
        allTimePoints={310}
        allTimeRead={{ state: "offline_cache", updatedAt: "2026-10-05T10:00:00.000Z" }}
        activeTab="tasks"
        onChange={vi.fn()}
      />,
    );
    expect(host.textContent).not.toMatch(/retr(y|ying|ies)/i);
    expect(host.textContent).not.toMatch(/queue|queued/i);
    expect(host.textContent).not.toMatch(/sync/i);
    // Exactly the three tiles the contract names.
    expect(host.querySelectorAll("button")).toHaveLength(2);
  });

  it("names the view switch so the panel it swaps is at least identifiable", () => {
    const host = render(
      <TasksStats
        pendingCount={3}
        completedCount={7}
        earnedThisWeek={42}
        allTimePoints={310}
        allTimeRead={{ state: "authoritative", updatedAt: null }}
        activeTab="tasks"
        onChange={vi.fn()}
      />,
    );
    const group = host.querySelector('[role="radiogroup"]');
    expect(group, "the switch is a radiogroup").not.toBeNull();
    expect(group!.getAttribute("aria-label")).toBe("Tasks view");
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(2);
  });
});
