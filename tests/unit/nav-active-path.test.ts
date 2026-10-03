// The active-item rule, pinned for the case the 2026-09 audit missed.
//
// `isPathActive` is segment-aware, which is right for ordinary drill-downs
// (`/settings/me` lights up Settings, `/meals/recipes/12` lights up Meals) — but
// `/meals/archive` is not a section OF Meals. It is a full-screen sibling that
// happens to sit under the same URL prefix, and prefix-matching reported it as an
// active Meals tab. Two consequences, both real:
//
//   1. On `/meals/archive` the dock showed Meals as the active cap while the
//      screen showing was the archive, so the dock was lying about where you were.
//   2. `navItemForPath("/meals/archive")` resolved to the Meals manifest entry, so
//      the no-orphan contract in `nav-items.test.ts` considered the route covered
//      — which is how a route with ZERO inbound links in `src/` could read as
//      "tracked" while hiding the week-restore UI.
//
// The fix is an explicit opt-out list (`OWN_DESTINATION_ROUTES`) rather than a
// heuristic, because nothing in the path can distinguish "section of Meals" from
// "sibling of Meals that happens to share the prefix". This suite also pins that
// an own-destination route can never be quietly unregistered: it must carry an
// `EXEMPT_ROUTES` reason, or the orphan contract would stop covering it.
import { describe, expect, it } from "vitest";
import {
  EXEMPT_ROUTES,
  OWN_DESTINATION_ROUTES,
  isPathActive,
  navItemForPath,
} from "@/lib/nav-items";

describe("isPathActive — a nested route is its parent's section only if it is one", () => {
  it("does not report /meals/archive as an active /meals tab", () => {
    expect(isPathActive("/meals/archive", "/meals")).toBe(false);
  });

  it("does not report anything under an own-destination route as the parent cap", () => {
    for (const route of OWN_DESTINATION_ROUTES) {
      expect(isPathActive(route, "/meals")).toBe(false);
      expect(isPathActive(`${route}/2026-09-14`, "/meals")).toBe(false);
    }
  });

  it("still activates the route itself if it ever gets a manifest entry", () => {
    expect(isPathActive("/meals/archive", "/meals/archive")).toBe(true);
    expect(isPathActive("/meals/archive/2026-09-14", "/meals/archive")).toBe(true);
  });

  it("keeps real drill-downs attached to their cap", () => {
    // The behaviour the rule exists for — none of these may regress.
    expect(isPathActive("/settings", "/settings")).toBe(true);
    expect(isPathActive("/settings/me", "/settings")).toBe(true);
    expect(isPathActive("/meals", "/meals")).toBe(true);
    expect(isPathActive("/meals/recipes/12", "/meals")).toBe(true);
  });

  it("keeps the exact-root and lookalike-prefix rules", () => {
    expect(isPathActive("/", "/")).toBe(true);
    expect(isPathActive("/meals", "/")).toBe(false);
    expect(isPathActive("/mealsomething", "/meals")).toBe(false);
    expect(isPathActive("/mealsarchive", "/meals")).toBe(false);
  });
});

describe("own-destination routes are tracked, not silently dropped", () => {
  it("resolves to no manifest entry, so it cannot masquerade as a covered route", () => {
    expect(navItemForPath("/meals/archive")).toBeUndefined();
  });

  it("gives every own-destination route an EXEMPT_ROUTES reason", () => {
    for (const route of OWN_DESTINATION_ROUTES) {
      expect(EXEMPT_ROUTES[route], `${route} needs a written reason`).toBeTruthy();
      expect(EXEMPT_ROUTES[route].length).toBeGreaterThan(20);
    }
  });

  it("keeps the list non-empty and free of duplicates", () => {
    expect(OWN_DESTINATION_ROUTES.length).toBeGreaterThan(0);
    expect(new Set(OWN_DESTINATION_ROUTES).size).toBe(OWN_DESTINATION_ROUTES.length);
  });
});