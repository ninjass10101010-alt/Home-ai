/**
 * nav-items.ts — the single navigation manifest (UI audit 2026-09 Phase 3).
 *
 * Every navigational surface reads THIS list, so a route can no longer be
 * reachable from one nav and invisible in another:
 *   - `components/ui/CapsuleNav.tsx`      — the dock (the only nav surface)
 *   - `components/patterns/MoreSheet.tsx` — the Home "More…" sheet
 *
 * Rules this file exists to enforce:
 *   1. One ordering. Every surface renders the same sequence, so `/chat` can
 *      never sit in position 2 on the phone and position 3 elsewhere.
 *   2. One active-item rule (`isPathActive`). The dock used `pathname === href`
 *      while a second nav used `startsWith`, so on `/settings/me` one surface
 *      showed no active item while the other highlighted Settings.
 *   3. No orphans. `tests/unit/nav-items.test.ts` enumerates every
 *      `src/app/**\/page.tsx` route and fails on any route that is neither
 *      reachable from this manifest nor listed in `EXEMPT_ROUTES` with a
 *      written reason.
 *
 * Roles mirror `src/lib/settings-sections.ts`: "guest" means *no session*
 * (the signed-out family/wall screen). Mode is NOT stored twice — it is derived
 * from role by `navModeForRole`, which reproduces `resolveMode()` in
 * `hooks/useDashboardMode` exactly (parent → adult, signed-in non-parent → kid,
 * signed out → family).
 *
 * `wall` marks the routes a signed-out screen may offer. Guest sessions are
 * shared screens, so personal or financial destinations opt out of `wall`.
 */

export type NavRole = "guest" | "parent" | "child" | "pet";
export type NavMode = "family" | "adult" | "kid";
/** "primary" = the dock/rail caps; "more" = the Home More… sheet. */
export type NavGroup = "primary" | "more";

/** Every icon the nav can ask for — locked to `components/ui/NavIcon.tsx`. */
export const NAV_ICON_KEYS = [
  "home",
  "ask",
  "meals",
  "tasks",
  "rewards",
  "calendar",
  "house",
  "settings",
  "grocery",
  "skill",
  "capsule",
  "analytics",
  "mountain",
  "memory",
  "photos",
] as const;

export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

export interface NavItemDefinition {
  /** Route the item points at. Always absolute, never carries a query string. */
  path: string;
  /** Accessible name, and the visible label in the dock. */
  label: string;
  iconKey: NavIconKey;
  roles: readonly NavRole[];
  group: NavGroup;
  /** May a signed-out (guest) screen offer this destination? */
  wall: boolean;
  /** Secondary items only: the one-line blurb shown in the More… sheet. */
  description?: string;
}

const ALL_ROLES: readonly NavRole[] = ["guest", "parent", "child", "pet"];
const SIGNED_IN_ROLES: readonly NavRole[] = ["parent", "child", "pet"];
const PARENT_ONLY: readonly NavRole[] = ["parent"];
/** Kid mode = signed-in non-parent (child or pet), same as `resolveMode()`. */
const KID_ROLES: readonly NavRole[] = ["child", "pet"];
/**
 * Home Assistant is adult tooling, so a signed-in child/pet never sees it.
 * Guests keep it: that is the pre-manifest dock behaviour on the family screen
 * and the source of the wall's light/climate controls.
 */
const HOUSE_ROLES: readonly NavRole[] = ["guest", "parent"];

/**
 * The manifest, in display order. The kid dock loses House and gains Rewards
 * purely through `roles` + this order — no mode-specific splicing, which is how
 * both modes stay at exactly 7 primary items (`CapsuleNav` sizes its capsule
 * for 7).
 */
export const NAV_ITEMS: readonly NavItemDefinition[] = [
  { path: "/", label: "Home", iconKey: "home", roles: ALL_ROLES, group: "primary", wall: true },
  { path: "/chat", label: "Ask", iconKey: "ask", roles: ALL_ROLES, group: "primary", wall: true },
  { path: "/meals", label: "Meals", iconKey: "meals", roles: ALL_ROLES, group: "primary", wall: true },
  { path: "/tasks", label: "Tasks", iconKey: "tasks", roles: ALL_ROLES, group: "primary", wall: true },
  { path: "/rewards", label: "Rewards", iconKey: "rewards", roles: KID_ROLES, group: "primary", wall: false },
  { path: "/calendar", label: "Calendar", iconKey: "calendar", roles: ALL_ROLES, group: "primary", wall: true },
  { path: "/ha", label: "House", iconKey: "house", roles: HOUSE_ROLES, group: "primary", wall: true },
  { path: "/settings", label: "Settings", iconKey: "settings", roles: ALL_ROLES, group: "primary", wall: true },

  // ── Secondary: every shipped route that had no inbound link before Phase 3 ──
  {
    path: "/grocery",
    label: "Grocery",
    iconKey: "grocery",
    description: "Shopping list and sync status",
    roles: ALL_ROLES,
    group: "more",
    wall: true,
  },
  {
    path: "/skill-tree",
    label: "Skill Tree",
    iconKey: "skill",
    description: "Quests, levels and badges",
    roles: ALL_ROLES,
    group: "more",
    wall: true,
  },
  {
    path: "/time-capsule",
    label: "Time Capsule",
    iconKey: "capsule",
    description: "Letters and photos for later",
    roles: ALL_ROLES,
    group: "more",
    wall: true,
  },
  {
    path: "/analytics",
    label: "Insights",
    iconKey: "analytics",
    description: "Schedule and routine patterns",
    roles: ALL_ROLES,
    group: "more",
    wall: true,
  },
  {
    path: "/money-mountain",
    label: "Money Mountain",
    iconKey: "mountain",
    description: "Savings goals and allowance",
    // Finance stays off the shared signed-out screen, like the ledger.
    roles: SIGNED_IN_ROLES,
    group: "more",
    wall: false,
  },
  {
    path: "/memory",
    label: "Family Memory",
    iconKey: "memory",
    description: "Addresses, allergies and preferences",
    // Mirrors the middleware allowlist: /memory is parent-only.
    roles: PARENT_ONLY,
    group: "more",
    wall: false,
  },
  {
    path: "/photos",
    label: "Photos",
    iconKey: "photos",
    description: "Add pictures and choose what the wall shows",
    // Uploading needs a session, so a signed-out wall or a guest device never
    // sees this row; the wall itself only ever displays.
    roles: SIGNED_IN_ROLES,
    group: "more",
    wall: false,
  },
];

/**
 * Role for a session. `null`/`undefined` is a guest (no PIN used yet).
 * An unknown *signed-in* role is treated as a child, matching `resolveMode()`
 * ("parent" is the only privileged role), so a future role can never inherit
 * adult navigation by accident.
 */
export function navRoleForUser(user: { role?: string } | null | undefined): NavRole {
  if (!user) return "guest";
  const role = user.role;
  if (role === "parent" || role === "child" || role === "pet") return role;
  return "child";
}

/** Mode implied by a role — the one place navigation derives mode from role. */
export function navModeForRole(role: NavRole): NavMode {
  if (role === "guest") return "family";
  if (role === "parent") return "adult";
  return "kid";
}

function isVisible(item: NavItemDefinition, role: NavRole): boolean {
  if (!item.roles.includes(role)) return false;
  // Guests are the shared screen: wall-safe destinations only.
  return role !== "guest" || item.wall;
}

/** Primary items (the dock caps) for a role, in manifest order. */
export function navItemsForRole(role: NavRole): NavItemDefinition[] {
  return NAV_ITEMS.filter((item) => item.group === "primary" && isVisible(item, role));
}

/** Secondary items for a role — the Home More… sheet. */
export function moreNavItemsForRole(role: NavRole): NavItemDefinition[] {
  return NAV_ITEMS.filter((item) => item.group === "more" && isVisible(item, role));
}

/**
 * Is `pathname` inside `path`? Exact for the root ("/" must not match every
 * route), segment-aware for everything else so `/mealsomething` never activates
 * `/meals`, while `/meals/recipes/12` and `/settings/me` both do.
 */
export function isPathActive(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isNavItemActive(pathname: string, item: NavItemDefinition): boolean {
  return isPathActive(pathname, item.path);
}

/** The manifest entry a route belongs to, if any (used for titles/breadcrumbs). */
export function navItemForPath(pathname: string): NavItemDefinition | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(pathname, item));
}

/**
 * Routes that deliberately have no manifest entry, each with its reason.
 * `tests/unit/nav-items.test.ts` fails when a route is in neither this map nor
 * the manifest — the "no orphans left" contract from the 2026-09 audit.
 */
export const EXEMPT_ROUTES: Readonly<Record<string, string>> = {
  "/design-system": "Dev-only design-system preview with the live self-audit (production-gated).",
  "/emergency":
    "Reference page reached from Settings → Safety and the wall Emergency action; not a dock cap.",
  "/ledger": "Parent-only finance iframe, reached from the Settings ledger widget.",
  "/player": "Reached from Home's Music widget (\"Open the full player\"); the dock is capped at seven caps and a widget drill-down is not one.",
  "/screensaver": "Typed wall URL only — CacheRefresher special-cases it so the wall can sleep.",
  "/suggestions": "Reached from Home's Suggestions widget (\"See all →\").",
};


