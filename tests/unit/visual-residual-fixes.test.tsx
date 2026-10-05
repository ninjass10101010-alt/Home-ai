// @vitest-environment jsdom
//
// Visual-residual fixes, 2026-10-05 wave. Each describe pins one critic finding
// from the live-server measurement round, in the file it owns:
//
//  - theme-config: the default accentHex must match the preset comparator, or
//    `--color-accent-button`/`--color-accent-border` get inline-pinned on <html>
//    and out-rank every `:root[data-theme]` rule.
//  - SwipeableRow: action layers must be invisible at rest and only appear
//    while the row is offset.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SwipeableRow from "@/components/ui/SwipeableRow";
import StatTile from "@/components/patterns/StatTile";
import Podium from "@/components/leaderboard/Podium";
import { defaultAccentHex } from "@/lib/theme-config";
import { warmGlassAccentOptions } from "@/lib/design-tokens";

/**
 * Mirror of `presetHexFor` in src/hooks/useTheme.tsx (READ-ONLY file): the
 * comparator the theme provider uses to decide whether a stored target still
 * holds its untouched preset value. glow/border compare against the preset's
 * `glow` (the DARK palette), selected/button against the preset's `hex`.
 */
function presetHexFor(id: string, target: "selected" | "glow" | "button" | "border"): string | undefined {
  const accent = warmGlassAccentOptions.find((option) => option.id === id);
  if (!accent) return undefined;
  return target === "glow" || target === "border" ? accent.glow : accent.hex;
}

describe("theme-config defaults agree with the preset comparator", () => {
  it("every defaultAccentHex target matches the nori preset value the comparator expects", () => {
    for (const target of ["selected", "glow", "button", "border"] as const) {
      const preset = presetHexFor("nori", target);
      expect(preset, `nori has a preset ${target}`).toBeTruthy();
      expect(
        defaultAccentHex[target].trim().toLowerCase(),
        `defaultAccentHex.${target} must equal the nori preset (${preset}) so isPresetValue() fires and no inline pin is written`
      ).toBe(preset!.trim().toLowerCase());
    }
  });

  it("a fresh nori profile therefore writes no inline accent pin on <html>", () => {
    // The observable symptom the critic verified: a fresh profile with a preset
    // accent must leave `--color-accent-button` / `--color-accent-border`
    // unset inline, so the stylesheet's per-theme derivation owns them.
    for (const target of ["selected", "glow", "button", "border"] as const) {
      const preset = presetHexFor("nori", target)!;
      const isPreset = preset.trim().toLowerCase() === defaultAccentHex[target].trim().toLowerCase();
      expect(isPreset, `${target}: stored default ${defaultAccentHex[target]} vs preset ${preset}`).toBe(true);
    }
  });
});

describe("calendar icon buttons carry the 44px hit-area guarantee", () => {
  it("every .calendar-icon-btn also carries .hit-44", () => {
    const src = readFileSync(join(process.cwd(), "src/app/calendar/page.tsx"), "utf8");
    // The three .calendar-icon-btn controls (TopBar add, prev/next month) are
    // sized 2.75rem = 44px in CSS but the critic measured 44.4×43.8 in the
    // browser — sub-pixel rounding drops them under the house 44px floor.
    // `.hit-44`'s `max(100%, 44px)` pseudo box closes that gap without any
    // layout change.
    const matches = [...src.matchAll(/className="calendar-icon-btn/g)];
    expect(matches.length, "the three calendar icon buttons are present").toBeGreaterThanOrEqual(3);
    const withHit = [...src.matchAll(/className="calendar-icon-btn hit-44"|className="hit-44 calendar-icon-btn"/g)].length;
    expect(withHit, "every calendar-icon-btn must carry hit-44").toBe(matches.length);
  });
});

describe("PageHeader eyebrow clears the h1", () => {
  it("the eyebrow carries at least mb-2 below it", () => {
    // The critic measured the eyebrow ("N PENDING") sitting flush against the
    // h1 — `mb-1` (4px) read as one block. mb-2 is the header's own spacing
    // step; the lede variant below the title uses mt-1.5+mt for the same
    // separation family.
    const src = readFileSync(join(process.cwd(), "src/components/patterns/PageHeader.tsx"), "utf8");
    expect(src, "eyebrow must be spaced off the title").toMatch(/text-eyebrow mb-2/);
    expect(src, "the old flush mb-1 is gone").not.toMatch(/text-eyebrow mb-1/);
  });
});

describe("SwipeableRow action layers are invisible at rest", () => {
  function setup() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <SwipeableRow leftAction={<span>✓</span>} rightAction={<span>✕</span>}>
          <div className="row-content">chore</div>
        </SwipeableRow>,
      );
    });
    return host;
  }

  const layers = (host: HTMLElement) => {
    // The two action layers are the absolute inset-y-0 siblings carrying the
    // accent tint; the content div is the translateX child.
    return [...host.querySelectorAll("div")].filter((d) => {
      const cls = d.className as string;
      return typeof cls === "string" && cls.includes("absolute") && cls.includes("inset-y-0");
    });
  };
  const content = (host: HTMLElement) => {
    const c = [...host.querySelectorAll("div")].find((d) => (d.className as string).includes("row-content"));
    return c?.parentElement as HTMLElement; // the transform-bearing wrapper
  };

  it("the ✓/✕ layers carry opacity 0 while the offset is zero", () => {
    const host = setup();
    const ls = layers(host);
    expect(ls.length, "two action layers").toBe(2);
    for (const layer of ls) {
      expect((layer as HTMLElement).style.opacity, "at rest the action layer must be fully transparent").toBe("0");
    }
    host.remove();
  });

  it("reveals the layers while dragged, then hides them again on a new press", () => {
    const host = setup();
    const row = content(host);
    act(() => {
      row.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 1 }));
    });
    act(() => {
      row.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 188, pointerId: 1 }));
    });
    for (const layer of layers(host)) {
      expect(Number((layer as HTMLElement).style.opacity), "mid-drag the layer must be visible").toBeGreaterThan(0);
    }
    act(() => {
      row.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 188, pointerId: 1 }));
    });
    // A fresh press re-settles the row: offset returns to zero, opacity back to 0.
    act(() => {
      row.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 2 }));
    });
    for (const layer of layers(host)) {
      expect((layer as HTMLElement).style.opacity, "after settle the action layer must hide again").toBe("0");
    }
    host.remove();
  });
});

describe("tasks board reserves dock clearance at the wall/board breakpoint", () => {
  it("the board grid reserves 7rem under the last row at the wall/board breakpoints", () => {
    // The board grid ended at pb-8 (32px) while the floating CapsuleNav
    // occupies ~110px, so at the wall fold the last row's title/meta sat under
    // the dock (critic-measured). Home's `main.wall-home-fit { padding-bottom:
    // 7rem }` is the precedent: pb-28 = 112px clears the 110px dock with 2px to
    // spare. Two gates, because the wall profile is 1080 wide (never 2xl) and
    // the 1920 board never sets data-wall.
    const src = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
    expect(src).toMatch(/px-4 pb-8 2xl:pb-28 \[html\[data-wall='true'\]_&\]\:pb-28 space-y-6 md:grid/);
  });
});

describe("StatTile labels use the accent-ink recipe on tone-tinted cards", () => {
  const INK: Record<string, string> = {
    accent: "--color-accent-ink",
    success: "--color-accent-ink-mint",
    warning: "--color-accent-ink-amber",
    danger: "--color-accent-ink-rose",
  };

  function renderTile(tone: string) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      createRoot(host).render(
        <StatTile label="Events" value={3} detail="Today" icon="📅" tone={tone as any} />,
      );
    });
    return host;
  }

  it.each(["accent", "success", "warning", "danger"] as const)(
    "the %s tone's label and detail read the matching ink token, not the raw neutral tokens",
    (tone) => {
      const host = renderTile(tone);
      const label = [...host.querySelectorAll("div")].find((d) => (d.textContent || "").trim() === "Events") as HTMLElement;
      const detail = [...host.querySelectorAll("div")].find((d) => (d.textContent || "").trim() === "Today") as HTMLElement;
      expect(label, "label renders").toBeTruthy();
      expect(detail, "detail renders").toBeTruthy();
      // The critic measured `text-text-secondary`/`text-text-muted` at
      // 3.97–4.45:1 on the tone-tinted card in dark; the house recipe for
      // text on a tone wash is the `--color-accent-ink-*` family.
      for (const el of [label, detail]) {
        expect(el.className, tone).toContain(`var(${INK[tone]})`);
        expect(el.className, tone).not.toMatch(/\btext-text-secondary\b|\btext-text-muted\b/);
      }
      host.remove();
    },
  );
});

describe("PlanTab tab chips (visual critic 2026-10-05)", () => {
  const SRC = () => readFileSync(join(process.cwd(), "src/components/meals/PlanTab.tsx"), "utf8");

  it("the active All pill deepens the accent fill so white ink clears AA", () => {
    // White on the raw `--color-accent-selected` measured 3.68:1 in dark (and
    // 2.44:1 on the light mint); the house recipe (Chip.selectedClass) is the
    // accent mixed 60% toward black — white on it is 4.60–8.33:1.
    const src = SRC();
    expect(src).toMatch(/bg-\[color-mix\(in_srgb,var\(--color-accent-selected\)_60%,black\)\] text-white/);
    expect(src).not.toMatch(/bg-\[var\(--color-accent-selected\)\] text-white/);
  });

  it("the active meal-type pill fill is the same 60%-black mix of its slot colour", () => {
    // slotColorVar returns the RAW accent (amber/mint/cyan/rose) and the pill
    // painted it under white text — mint is 1.74:1. The fill must be the
    // deepened mix, never the raw slot colour.
    const src = SRC();
    expect(src).toMatch(/backgroundColor: `color-mix\(in srgb, \$\{slotColorVar\(type\.id\)\} 60%, black\)`/);
    expect(src).not.toMatch(/backgroundColor: slotColorVar\(type\.id\)/);
  });

  it("the empty-slot meal emoji is no longer faded to opacity-50", () => {
    // The opacity-50 emoji measured 2.40:1 dark / 1.95:1 light. The glyph
    // must inherit the button's token ink at full strength.
    const src = SRC();
    expect(src).not.toMatch(/text-lg transition-colors \$\{isPickerOpen \? "opacity-100" : "opacity-50/);
  });

  it("the meal meta chips (kcal / prep / servings) read text-secondary, not muted", () => {
    // The three rounded-full meta chips inherited text-text-muted and
    // measured 4.49:1 in light — a hair under the floor. text-text-secondary
    // on the same glass-subtle surface measures 6.1:1+.
    const src = SRC();
    expect(src).toMatch(/mt-1 flex flex-wrap items-center gap-1\.5 text-xs font-semibold text-text-secondary/);
  });
});

describe("Podium at 390 (visual critic 2026-10-05)", () => {
  const ALL_TIME = { state: "error" as const, updatedAt: null };

  function renderPodium(entries: any[], previousRanks: Record<string, number>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      createRoot(host).render(
        <Podium
          entries={entries}
          prizes={[]}
          previousRanks={previousRanks}
          isYou={() => false}
          getMemberColor={() => "green"}
          onOpenSheet={() => {}}
          onAdjust={() => {}}
          isAdmin={false}
          allTimeRead={ALL_TIME}
        />,
      );
    });
    return host;
  }

  const baseEntry = (name: string, points: number) => ({
    name, points, emoji: "👧", color: "rose", rank: 0, streak: 0,
    allTimePoints: null, allTimeComps: null,
  });

  it("suppresses the dead '—' when a member has no previous rank", () => {
    // A brand-new member (no previousRanks entry) rendered RankArrow's "—"
    // alone — dead punctuation from an empty value. It must not render.
    const host = renderPodium(
      [baseEntry("Jasmine Garcia", 28), baseEntry("Caspian Garcia", 22), baseEntry("Emily Garcia", 15)],
      {},
    );
    expect(host.textContent).not.toContain("—");
    host.remove();
  });

  it("keeps the '—' for an unchanged real rank", () => {
    // The dash is meaningful when it means "rank unchanged since last week"
    // (a REAL previous rank equal to the current one) — only the empty-value
    // case is dead punctuation.
    const host = renderPodium(
      [baseEntry("Jasmine Garcia", 28), baseEntry("Caspian Garcia", 22)],
      { "Jasmine Garcia": 1, "Caspian Garcia": 2 },
    );
    expect(host.textContent).toContain("—");
    host.remove();
  });

  it("the points row cannot wrap into a dangling 'pts' line", () => {
    const host = renderPodium([baseEntry("Jasmine Garcia", 28), baseEntry("Caspian Garcia", 22)], {});
    const pts = [...host.querySelectorAll("span")].find((s) => s.textContent === "pts");
    expect(pts, "the pts suffix renders").toBeTruthy();
    expect(pts!.parentElement!.className, "the number+pts row must not wrap").toContain("whitespace-nowrap");
    host.remove();
  });

  it("the prize pill stays below the sm fold and carries its full text as title", () => {
    const src = readFileSync(join(process.cwd(), "src/components/leaderboard/Podium.tsx"), "utf8");
    // At 390 the three columns are ~100px: the prize pill must stay hidden
    // (sm:block) so it can never truncate to "Picks Friday's famil…", and the
    // full text rides the title attribute for tablet and up.
    expect(src).toMatch(/hidden text-center text-xs text-text-muted line-clamp-2 break-words sm:block/);
    expect(src).toContain('title={prize.text}');
  });
});
