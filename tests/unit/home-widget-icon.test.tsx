import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomeWidgetIcon, {
  HOME_WIDGET_ICON_VARIANTS,
  type HomeWidgetIconState,
  type HomeWidgetIconVariant,
} from "@/components/ui/HomeWidgetIcon";

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
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('fill="#fff"');
  });

  it("keeps decorative artwork out of the accessibility tree", () => {
    const markup = renderToStaticMarkup(
      <HomeWidgetIcon variant="briefing" title="Morning briefing" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain("<title>Morning briefing</title>");
    expect(markup).not.toContain("aria-label=");
    expect(markup).not.toContain("role=");
    expect(markup).not.toMatch(/<text\b/);
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
});
