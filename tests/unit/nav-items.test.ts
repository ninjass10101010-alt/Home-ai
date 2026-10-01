import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXEMPT_ROUTES,
  NAV_ICON_KEYS,
  NAV_ITEMS,
  isPathActive,
  moreNavItemsForRole,
  navItemForPath,
  navItemsForRole,
  navModeForRole,
  navRoleForUser,
  type NavRole,
} from "@/lib/nav-items";

const APP = join(process.cwd(), "src", "app");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

/** Every shipped route, dynamic segments collapsed to their parent. */
function shippedRoutes(): string[] {
  return routeFiles(APP)
    .map((file) => file.slice(APP.length).replace(/\/page\.tsx$/, ""))
    .map((route) => route.split("/").filter((seg) => !seg.startsWith("[")).join("/") || "/")
    .sort();
}

const PARENT_LABELS = ["Home", "Ask", "Meals", "Tasks", "Calendar", "House", "Settings"];
const KID_LABELS = ["Home", "Ask", "Meals", "Tasks", "Rewards", "Calendar", "Settings"];

describe("nav manifest — primary items", () => {
  it("gives a parent and a guest the 7 pre-manifest caps, in that order", () => {
    expect(navItemsForRole("parent").map((item) => item.label)).toEqual(PARENT_LABELS);
    expect(navItemsForRole("guest").map((item) => item.label)).toEqual(PARENT_LABELS);
  });

  it("swaps House for Rewards after Tasks for a child and a pet", () => {
    expect(navItemsForRole("child").map((item) => item.label)).toEqual(KID_LABELS);
    expect(navItemsForRole("pet").map((item) => item.label)).toEqual(KID_LABELS);
    expect(navItemsForRole("child")).toHaveLength(7);
  });

  it("keeps every path unique and absolute, with a label and a known icon", () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const item of NAV_ITEMS) {
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(NAV_ICON_KEYS).toContain(item.iconKey);
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });

  it("describes every secondary item so the More… sheet never renders a blank row", () => {
    for (const item of NAV_ITEMS.filter((entry) => entry.group === "more")) {
      expect(item.description?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("nav manifest — secondary items", () => {
  it("surfaces every formerly orphaned route plus Photos for a parent", () => {
    expect(moreNavItemsForRole("parent").map((item) => item.path)).toEqual([
      "/grocery",
      "/skill-tree",
      "/time-capsule",
      "/analytics",
      "/money-mountain",
      "/memory",
      "/photos",
    ]);
  });

  it("withholds the parent-only and off-wall destinations per role", () => {
    // Photos needs a session to upload into, so it appears for a signed-in
    // child but never for a guest — the signed-out wall cannot push pictures.
    const child = moreNavItemsForRole("child").map((item) => item.path);
    expect(child).toEqual([
      "/grocery",
      "/skill-tree",
      "/time-capsule",
      "/analytics",
      "/money-mountain",
      "/photos",
    ]);

    const guest = moreNavItemsForRole("guest").map((item) => item.path);
    expect(guest).toEqual(["/grocery", "/skill-tree", "/time-capsule", "/analytics"]);
  });
});

describe("nav manifest — active item", () => {
  it("activates the root only on the root", () => {
    expect(isPathActive("/", "/")).toBe(true);
    expect(isPathActive("/meals", "/")).toBe(false);
    expect(isPathActive("/settings/me", "/")).toBe(false);
  });

  it("activates a cap on its own page and on nested pages", () => {
    expect(isPathActive("/settings", "/settings")).toBe(true);
    expect(isPathActive("/settings/me", "/settings")).toBe(true);
    expect(isPathActive("/meals/recipes/12", "/meals")).toBe(true);
  });

  it("does not activate on a lookalike prefix", () => {
    expect(isPathActive("/mealsomething", "/meals")).toBe(false);
    expect(isPathActive("/settingsomething", "/settings")).toBe(false);
  });

  it("resolves a route to its manifest entry", () => {
    expect(navItemForPath("/settings/me")?.label).toBe("Settings");
    expect(navItemForPath("/memory")?.label).toBe("Family Memory");
    expect(navItemForPath("/emergency")).toBeUndefined();
  });
});

describe("nav manifest — role and mode", () => {
  it("maps sessions to roles, treating an unknown signed-in role as a child", () => {
    expect(navRoleForUser(null)).toBe("guest");
    expect(navRoleForUser(undefined)).toBe("guest");
    expect(navRoleForUser({ role: "parent" })).toBe("parent");
    expect(navRoleForUser({ role: "pet" })).toBe("pet");
    expect(navRoleForUser({ role: "child" })).toBe("child");
    expect(navRoleForUser({ role: "grandparent" })).toBe("child");
  });

  it("derives the same mode resolveMode() does", () => {
    const modes: Record<NavRole, string> = {
      guest: "family",
      parent: "adult",
      child: "kid",
      pet: "kid",
    };
    for (const [role, mode] of Object.entries(modes)) {
      expect(navModeForRole(role as NavRole)).toBe(mode);
    }
  });
});

describe("nav manifest — no route is orphaned", () => {
  it("covers every shipped route with the manifest or a written exemption", () => {
    const orphans = shippedRoutes().filter(
      (route) => !navItemForPath(route) && !EXEMPT_ROUTES[route],
    );
    expect(orphans, `unreachable routes: ${orphans.join(", ")}`).toEqual([]);
  });

  it("never exempts a route the manifest already covers", () => {
    for (const route of Object.keys(EXEMPT_ROUTES)) {
      expect(navItemForPath(route), `${route} is both in the manifest and exempt`).toBeUndefined();
    }
  });

  it("keeps no stale exemption, and every exemption states a reason", () => {
    const shipped = new Set(shippedRoutes());
    for (const [route, reason] of Object.entries(EXEMPT_ROUTES)) {
      expect(shipped.has(route), `${route} is exempt but no longer ships`).toBe(true);
      expect(reason.length, `${route} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

