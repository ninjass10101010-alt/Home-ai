import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import HomeWidgetIcon, {
  HOME_WIDGET_ICON_VARIANTS,
  type HomeWidgetIconState,
  type HomeWidgetIconVariant,
} from "@/components/ui/HomeWidgetIcon";
import WidgetCard from "@/components/patterns/WidgetCard";

const expectedVariants = [
  "briefing",
  "ask",
  "suggestions",
  "leaderboard",
  "events",
  "schedule",
  "meal",
  "tasks",
  "week",
  "security",
  "climate",
  "lights",
  "ledger",
] as const satisfies readonly HomeWidgetIconVariant[];

const expectedStates = [
  "default",
  "near",
  "unread",
  "on",
  "attention",
] as const satisfies readonly HomeWidgetIconState[];

const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function render(variant: HomeWidgetIconVariant, state?: HomeWidgetIconState) {
  return renderToStaticMarkup(<HomeWidgetIcon variant={variant} state={state} />);
}

describe("HomeWidgetIcon", () => {
  it("exports the complete supported variant set", () => {
    expect(HOME_WIDGET_ICON_VARIANTS).toEqual(expectedVariants);
  });

  it.each(expectedVariants)("renders deterministic %s artwork", (variant) => {
    const markup = render(variant);

    expect(markup).toBe(render(variant));
    expect(markup).toContain('viewBox="0 0 48 48"');
    expect(markup).toContain(`data-variant="${variant}"`);
    expect(markup).toContain('stroke="var(--home-widget-icon-ink)"');
    expect(markup).toContain('fill="var(--home-widget-icon-accent)"');
    expect(markup).toContain('fill="#fff"');
  });

  it("keeps white icon surfaces on explicit dark ink and tone accents", () => {
    const wrapperMarkup = renderToStaticMarkup(
      <WidgetCard tone="#8b5cf6" icon={<HomeWidgetIcon variant="tasks" size="lg" />}>
        <span>content</span>
      </WidgetCard>,
    );
    const iconMarkup = render("tasks");
    const iconCssStart = globalsCss.indexOf(".home-widget-icon {");
    const iconCssEnd = globalsCss.indexOf(".home-widget-icon-state-default", iconCssStart);
    const iconCss = globalsCss.slice(iconCssStart, iconCssEnd);

    expect(wrapperMarkup).toMatch(/--widget-tone:\s*#8b5cf6/);
    expect(iconMarkup).toContain('stroke="var(--home-widget-icon-ink)"');
    expect(iconMarkup).toContain('fill="var(--home-widget-icon-accent)"');
    expect(iconMarkup).not.toContain("currentColor");
    expect(iconCss).toMatch(/--home-widget-icon-ink:\s*#1e293b;/);
    expect(iconCss).toMatch(
      /--home-widget-icon-accent:\s*color-mix\(in srgb, var\(--widget-tone, var\(--color-accent-selected\)\) 50%, var\(--home-widget-icon-ink\)\);/,
    );
    expect(iconCss).toContain("color: var(--home-widget-icon-ink);");
  });

  it("keeps decorative artwork out of the accessibility tree", () => {
    const markup = renderToStaticMarkup(<HomeWidgetIcon variant="briefing" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toContain("<title");
    expect(markup).not.toContain("aria-label=");
    expect(markup).not.toContain("role=");
    expect(markup).not.toMatch(/<text\b/);
  });

  it("exposes an explicit title as an accessible standalone name", () => {
    const markup = renderToStaticMarkup(
      <HomeWidgetIcon variant="briefing" title="Morning briefing" />,
    );

    expect(markup).not.toContain('aria-hidden="true"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Morning briefing"');
    expect(markup).toContain('focusable="false"');
  });

  it.each([
    ["sm", "h-8 w-8"],
    ["md", "h-12 w-12"],
    ["lg", "h-16 w-16"],
  ] as const)("uses the %s size classes", (size, sizeClasses) => {
    const markup = renderToStaticMarkup(
      <HomeWidgetIcon variant="tasks" size={size} />,
    );

    expect(markup).toContain(sizeClasses);
  });

  it("exposes semantic state without accessible text", () => {
    const state: HomeWidgetIconState = expectedStates[3];
    const markup = render("lights", state);

    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/<text\b/);
  });

  it.each(expectedStates)("exposes a stable motion class for %s", (state) => {
    const markup = render("briefing", state);

    expect(markup).toContain(`home-widget-icon-state-${state}`);
  });

  it("gives SVG state transforms an explicit view-box origin", () => {
    const markup = render("tasks", "near");

    expect(markup).toContain("transform-box:view-box");
    expect(markup).toContain("transform-origin:24px 24px");
  });

  it("keeps state motion finite and neutralizes it under reduced motion", () => {
    const motionStart = globalsCss.indexOf(".home-widget-icon {");
    const motionEnd = globalsCss.indexOf(':root[data-theme="light"] .widget-card', motionStart);
    const motionCss = globalsCss.slice(motionStart, motionEnd);
    const reducedMotionStart = motionCss.indexOf("@media (prefers-reduced-motion: reduce)");
    const reducedMotionEnd = reducedMotionStart >= 0 ? motionCss.indexOf("}", reducedMotionStart) : -1;
    const reducedMotionCss = motionCss.slice(reducedMotionStart, reducedMotionEnd);

    expect(motionStart).toBeGreaterThan(-1);
    expect(motionEnd).toBeGreaterThan(motionStart);
    for (const state of expectedStates) {
      expect(motionCss).toContain(`.home-widget-icon-state-${state}`);
    }
    expect(motionCss).toContain("transition: transform 220ms");
    expect(motionCss).not.toContain("infinite");
    expect(reducedMotionStart).toBeGreaterThan(-1);
    expect(reducedMotionEnd).toBeGreaterThan(reducedMotionStart);
    expect(reducedMotionCss).toMatch(/\.home-widget-icon[\s\S]*?transform:\s*none\s*!important;/);
    expect(motionCss).toContain("animation: none !important;");
    expect(motionCss).toContain("transition: none !important;");
  });
});
