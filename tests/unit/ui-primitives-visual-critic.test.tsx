// @vitest-environment jsdom
/**
 * Visual-critic contracts for the shared `ui/` + `patterns/` primitives.
 *
 * These pin four defects that were MEASURED in a real browser (Chromium,
 * `prefers-color-scheme` forced per context, all ten accents) and not merely
 * reasoned about. Each one is a class-output trap: in Tailwind v4 two utilities
 * for the same property in one layer resolve by STYLESHEET order, not by
 * `className` order, and unlayered CSS out-ranks `@layer utilities` outright —
 * so "the later class wins" is not a safe assumption to build a primitive on.
 *
 * jsdom resolves neither `var()` nor `color-mix()`, so these assert the CLASS
 * SHAPE that produces the measured value, and carry the measurement in the
 * comment. The contrast arithmetic itself lives in the measured tables in
 * `ui/SoftButton.tsx`, `ui/Chip.tsx` and `ui/Toast.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Chip from "@/components/ui/Chip";
import Toast from "@/components/ui/Toast";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Surface, { type SurfaceVariant } from "@/components/ui/Surface";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SyncStatusBanner from "@/components/ui/SyncStatusBanner";
import DayStrip from "@/components/patterns/DayStrip";

const mockAuth = { isLoggedIn: false } as { isLoggedIn: boolean };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

let container: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});

afterEach(async () => {
  await act(async () => { reactRoot.unmount(); });
  document.body.removeChild(container);
});

async function render(node: React.ReactNode) {
  await act(async () => { reactRoot.render(node); });
  return container;
}

function byText(text: string): HTMLElement {
  const el = Array.from(container.querySelectorAll<HTMLElement>("button, a, span, div")).find(
    (n) => n.textContent?.trim() === text,
  );
  if (!el) throw new Error(`no element with text "${text}"`);
  return el;
}

/** The deepened-accent fill: white label needs 4.5:1 and no raw preset clears it. */
const ACCENT_FILL = /bg-\[color-mix\(in_srgb,var\(--color-accent-selected\)_60%,black\)\]/;
/** The `--color-accent-ink-*` formula (accent walked 55% toward body ink). */
const ACCENT_INK = /color-mix\(in_srgb,var\(--color-accent-[a-z]+\)_55%,var\(--color-text-primary\)\)/;

describe("Chip — selected state", () => {
  it("omits BOTH the base fill and the tone ink when selected", async () => {
    // Measured: the tone's `.widget-accent-text` is UNLAYERED, so it out-ranks
    // the selected branch's `text-white` and the chip painted the raw accent on
    // the deepened accent fill — 2.21:1 dark, 1.99:1 light, 1.23:1 inside a
    // `.widget-card`. Omitting the tone class entirely is the only fix; adding
    // `!text-white` would also work but leaves the fragile contest in place.
    for (const tone of ["neutral", "accent", "success", "danger", "warning", "violet", "cyan"] as const) {
      const root = await render(<Chip tone={tone} selected>Pick</Chip>);
      const chip = byText("Pick");
      expect(chip.className, `${tone}: base fill must be absent`).not.toMatch(/bg-\[var\(--color-surface-0\)\]/);
      expect(chip.className, `${tone}: tone ink must be absent`).not.toMatch(/widget-accent-text/);
      expect(chip.className, `${tone}: white label must apply`).toMatch(/\btext-white\b/);
      expect(chip.className, `${tone}: accent fill must apply`).toMatch(ACCENT_FILL);
    }
  });

  it("keeps the base fill and the tone ink when NOT selected", async () => {
    const root = await render(<Chip tone="accent">Pick</Chip>);
    const cls = byText("Pick").className;
    expect(cls).toMatch(/bg-\[var\(--color-surface-0\)\]/);
    expect(cls).toMatch(ACCENT_INK);
    expect(cls).not.toMatch(ACCENT_FILL);
  });

  it("mixes every unguarded tone toward body ink instead of using the raw accent", async () => {
    // Measured across all ten accents in both themes. `accent` fell to
    // 3.09-3.77:1 in light (cyan / mint / amber / apricot / sage) because
    // `widget-accent-text` only deepens inside a widget card and only in light;
    // `cyan` measured 3.68:1 light; `violet` passed at 5.70:1 but shared the
    // unguarded pattern. After the mix, on BOTH the frosted chip surface and
    // inside a `.widget-card`: accent 5.75-13.05:1, cyan 6.83-10.83:1,
    // violet 8.96-10.04:1. `success` / `warning` / `danger` are exempt on
    // purpose — they carry the `chip-tone-*` hooks globals.css already deepens
    // in light behind an unlayered, already-passing guard.
    for (const tone of ["accent", "violet", "cyan"] as const) {
      const root = await render(<Chip tone={tone}>Pick</Chip>);
      const cls = byText("Pick").className;
      expect(cls, tone).toMatch(ACCENT_INK);
      expect(cls, tone).not.toMatch(new RegExp(`text-\\[var\\(--color-accent-${tone}\\)\\]`));
      if (tone === "accent") expect(cls, tone).not.toMatch(/widget-accent-text/);
    }
    for (const tone of ["success", "warning", "danger"] as const) {
      const root = await render(<Chip tone={tone}>Pick</Chip>);
      expect(byText("Pick").className, tone).toMatch(new RegExp(`chip-tone-${tone}`));
    }
  });

  it("reads as inert when disabled rather than half-faded", async () => {
    // `disabled:opacity-50` faded the chip toward its backdrop while keeping its
    // coloured fill — a control that still looked pressable and had lost its
    // label. Converges on the neutral raised surface instead. The `!important`
    // modifiers are load-bearing: the unlayered `.chip-tone-*:not(.chip-selected)`
    // light-mode guards in globals.css would otherwise win.
    const root = await render(<Chip tone="danger" disabled>Pick</Chip>);
    const cls = byText("Pick").className;
    expect(cls).not.toMatch(/disabled:opacity-50/);
    expect(cls).toMatch(/disabled:!bg-\[var\(--color-surface-2\)\]/);
    expect(cls).toMatch(/disabled:!text-\[var\(--color-text-secondary\)\]/);
  });

  it("still carries the 44px hit region and the static-label escape hatch", async () => {
    await render(<Chip>Pick</Chip>);
    expect(byText("Pick").className).toMatch(/hit-44/);
    await render(<Chip as="span">Tag</Chip>);
    expect(byText("Tag").tagName).toBe("SPAN");
    expect(byText("Tag").className).not.toMatch(/hit-44/);
  });
});

describe("Toast — tone legibility", () => {
  const TONES = ["neutral", "success", "error"] as const;

  it("mixes success and error ink toward body ink, never the raw accent", async () => {
    // Measured on a real toast over `--color-surface-0`: raw accent ink on a 15%
    // wash of itself gave 3.14:1 (light success), 3.71:1 (light error) and
    // 4.45:1 (dark error) — three of four non-neutral tones under the floor.
    // After: success 9.74:1 dark / 5.84:1 light, error 7.25:1 / 6.64:1.
    for (const tone of ["success", "error"] as const) {
      await render(<Toast open tone={tone}>Saved</Toast>);
      const toast = container.querySelector('[role="status"]')!;
      expect(toast.className, tone).toMatch(ACCENT_INK);
      expect(toast.className, tone).not.toMatch(new RegExp(`text-\\[var\\(--color-accent-${tone}\\)\\]`));
    }
  });

  it("keeps every tone announced politely and rendering the neutral border token", async () => {
    for (const tone of TONES) {
      await render(<Toast open tone={tone}>Saved</Toast>);
      const toast = container.querySelector('[role="status"]')!;
      expect(toast.getAttribute("role"), tone).toBe("status");
      expect(toast.getAttribute("aria-live"), tone).toBe("polite");
      // `border-white/10` was 10% white — invisible against the light theme's
      // near-white toast, so a neutral toast had no boundary at all in light.
      expect(toast.className, tone).not.toMatch(/border-white\//);
    }
  });
});

describe("SoftButton — primary fill", () => {
  it("derives the primary fill from --color-accent-selected, not the poisoned token", async () => {
    // `--color-accent-button` is written as an INLINE style on <html> by
    // `useTheme`, and an inline declaration out-ranks every
    // `:root[data-theme="…"]` rule. On the default theme config
    // `isPresetValue()` never fires for the `button` target, so the token
    // resolved to `#2563eb` — the LIGHT palette — in BOTH themes and for ALL
    // ten accents (verified in Chromium: `data-theme="dark"` →
    // `--color-accent-button: #2563eb`). White on it is 5.17:1; the intended
    // mix gives 12.31:1 dark / 14.14:1 light.
    const root = await render(<SoftButton variant="primary">Save</SoftButton>);
    const cls = byText("Save").className;
    expect(cls).toMatch(ACCENT_FILL);
    expect(cls).not.toMatch(/bg-\[var\(--color-accent-button\)\]/);
    expect(cls).toMatch(/\btext-white\b/);
  });

  it("still offers every variant and size with its original class output", async () => {
    for (const variant of ["primary", "secondary", "ghost", "danger", "success"] as const) {
      for (const size of ["sm", "md", "lg", "icon"] as const) {
        await render(<SoftButton variant={variant} size={size}>Go</SoftButton>);
        expect(byText("Go"), `${variant}/${size}`).toBeTruthy();
      }
    }
    // The secondary ink formula is the one this wave was commissioned to verify.
    await render(<SoftButton variant="secondary">Go</SoftButton>);
    expect(byText("Go").className).toMatch(ACCENT_INK);
  });

  it("drops every trace of accent when disabled", async () => {
    for (const variant of ["primary", "secondary", "ghost", "danger", "success"] as const) {
      await render(<SoftButton variant={variant} disabled>Go</SoftButton>);
      const btn = byText("Go") as HTMLButtonElement;
      expect(btn.disabled, variant).toBe(true);
      expect(btn.className, variant).toMatch(/!bg-\[var\(--color-surface-2\)\]/);
      expect(btn.className, variant).toMatch(/!shadow-none/);
      expect(btn.className, variant).not.toMatch(/disabled:opacity-50/);
    }
  });
});

describe("IconButton — accent glyph legibility", () => {
  it("mixes the accent glyph toward body ink instead of using the raw accent", async () => {
    // `bg-[var(--color-accent-selected)]/15` + `text-[var(--color-accent-selected)]`
    // — a wash of the same hue barely moves the value. Measured across all ten
    // accents in both themes, EVERY one of the sixty samples was under the bar:
    // 4.17-4.45:1 dark, 2.65-4.20:1 light (worst: light sage 2.65, light amber
    // 2.72). A glyph is a graphical object, so 1.4.11 asks only 3:1 — amber and
    // apricot failed even that. After the mix: 5.24-9.74:1.
    const root = await render(<IconButton variant="accent" aria-label="Pick">★</IconButton>);
    const cls = (container.querySelector("button") as HTMLElement).className;
    expect(cls).toMatch(/bg-\[var\(--color-accent-selected\)\]\/15/);
    expect(cls).toMatch(/text-\[color-mix\(in_srgb,var\(--color-accent-selected\)_55%,var\(--color-text-primary\)\)\]/);
    expect(cls).not.toMatch(/text-\[var\(--color-accent-selected\)\]/);
  });

  it("keeps every variant and size, and the 44px region on sm", async () => {
    for (const variant of ["glass", "accent", "danger", "ghost"] as const) {
      for (const size of ["sm", "md", "lg"] as const) {
        await render(<IconButton variant={variant} size={size} aria-label="X">★</IconButton>);
        expect(container.querySelector("button"), `${variant}/${size}`).toBeTruthy();
      }
    }
    await render(<IconButton size="sm" aria-label="X">★</IconButton>);
    expect((container.querySelector("button") as HTMLElement).className).toMatch(/hit-44/);
  });
});

describe("The deepened-accent fill is derived, never read from the token", () => {
  // `--color-accent-button` is written as an INLINE style on <html> by
  // `useTheme` and therefore out-ranks every `:root[data-theme="…"]` rule. On a
  // pristine `localStorage` `isPresetValue()` never fires for the `button`
  // target, so it resolved to `#2563eb` — the LIGHT palette — in BOTH themes and
  // for ALL ten accents (verified in Chromium). Every one of these four sites
  // pairs it with a WHITE label, so each was both the wrong hue for the family
  // and one value away from the floor. They all derive from
  // `--color-accent-selected` now.
  it("SegmentedControl's emphasize pill", async () => {
    await render(
      <SegmentedControl
        emphasize
        aria-label="View"
        value="a"
        onChange={() => {}}
        options={[{ id: "a", label: "Tasks" }, { id: "b", label: "Board" }]}
      />,
    );
    const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    // the pill is a two-stop linear-gradient, so the mix appears inside
    // `bg-[linear-gradient(...)]` rather than as a bare `bg-[color-mix(...)]`
    expect(pill.className).toMatch(/bg-\[linear-gradient\(135deg,/);
    expect(pill.className).toMatch(/color-mix\(in_srgb,var\(--color-accent-selected\)_60%,black\)/);
    expect(pill.className).not.toMatch(/color-accent-button/);
  });

  it("SegmentedControl's quiet pill and every variant/size still render", async () => {
    for (const emphasize of [false, true]) {
      for (const compact of [false, true]) {
        await render(
          <SegmentedControl
            emphasize={emphasize}
            compact={compact}
            aria-label="View"
            value="a"
            onChange={() => {}}
            options={[{ id: "a", label: "Tasks" }, { id: "b", label: "Board" }]}
          />,
        );
        expect(container.querySelectorAll('[role="radio"]').length, `${emphasize}/${compact}`).toBe(2);
      }
    }
  });

  it("DayStrip's active day", async () => {
    const days = [
      { id: "mon", label: "Mon" },
      { id: "tue", label: "Tue" },
    ];
    await render(<DayStrip days={days} value="tue" onChange={() => {}} />);
    const active = container.querySelector('[aria-pressed="true"]') as HTMLElement;
    expect(active.className).toMatch(ACCENT_FILL);
    expect(active.className).not.toMatch(/color-accent-button/);
    // every day keeps the 44px floor in both densities
    for (const compact of [false, true]) {
      await render(<DayStrip compact={compact} days={days} value="tue" onChange={() => {}} />);
      for (const el of container.querySelectorAll("button")) {
        expect(el.className).toMatch(/min-h-11/);
      }
    }
  });
});

describe("Surface — material tiers", () => {
  it("emits a material tier for every legacy glass alias", async () => {
    // globals.css declares `.material-thin, .glass-subtle`,
    // `.material-regular, .glass` and `.material-thick, .glass-strong` in one
    // shared block each, so this is a pure rename with no rendering change — it
    // just stops the primitive being the last caller of a legacy alias.
    const expected: Partial<Record<SurfaceVariant, RegExp>> = {
      glass: /material-regular/,
      "glass-strong": /material-thick/,
      "glass-subtle": /material-thin/,
      "material-regular": /material-regular/,
      "material-thick": /material-thick/,
    };
    for (const [variant, tier] of Object.entries(expected) as [SurfaceVariant, RegExp][]) {
      await render(<Surface variant={variant}>Box</Surface>);
      const cls = byText("Box").className;
      expect(cls, variant).toMatch(tier);
      expect(cls, variant).not.toMatch(/(?<![\w-])glass(?![\w-])/);
    }
  });

  it("makes `flat` actually flat", async () => {
    // `.material-*` is UNLAYERED, so its `background` out-ranks a Tailwind
    // `bg-*` utility no matter where the utility sits in the class list — the
    // old `flat` listed `material-regular` and then
    // `bg-[var(--color-surface-2)]`, and the utility simply never applied.
    await render(<Surface variant="flat">Box</Surface>);
    const cls = byText("Box").className;
    expect(cls).not.toMatch(/material-/);
    expect(cls).toMatch(/bg-\[var\(--color-surface-2\)\]/);
    expect(cls).toMatch(/border-border/);
    expect(cls).not.toMatch(/border-white\//);
  });
});

describe("SyncStatusBanner", () => {
  it("gives its sign-in link a 44px hit region", async () => {
    // Measured 145.9 x 19.5 CSS px for the one action the banner exists to
    // offer, on every route that renders PageShell. `.hit-44` grows the hit box
    // with no layout change.
    mockAuth.isLoggedIn = false;
    await render(<SyncStatusBanner />);
    const link = container.querySelector('[data-testid="sync-status-banner-signin"]')!;
    expect(link.className).toMatch(/hit-44/);
  });

  it("renders nothing at all once the family is signed in", async () => {
    mockAuth.isLoggedIn = true;
    await render(<SyncStatusBanner />);
    expect(container.querySelector('[data-testid="sync-status-banner"]')).toBeNull();
    mockAuth.isLoggedIn = false;
  });
});