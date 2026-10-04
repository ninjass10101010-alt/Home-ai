/**
 * Money Mountain — who is looking, and what that viewer may do.
 *
 * The manifest lists `/money-mountain` for `SIGNED_IN_ROLES` on purpose
 * ("Finance stays off the shared signed-out screen, like the ledger"), and a
 * child watching their own mountain climb is the whole motivational point of
 * the feature. So the page is NOT hidden from a child.
 *
 * What changed instead is honesty. Every WRITE in this domain is parent-only
 * behind `requireLiveSession({ requireRole: 'parent' })`, so a child's read of
 * this page is legitimately, permanently read-only. A read-only page is a
 * designed state, not a degraded one, and it has to say so:
 *
 *   1. A control exists iff it works. No control is painted that would 403.
 *   2. A missing control is replaced by a real sentence, never a dead gap.
 *   3. A state that is working as designed never borrows the language of a
 *      failure ("Failed to load…", "Create Your First Mountain" for a viewer
 *      who cannot create).
 *   4. A read that genuinely failed says what actually happened.
 *
 * Pure and client-safe on purpose: `src/lib/money-mountain.ts` is the
 * PocketBase seam and must never be pulled into a page. An unresolved identity
 * (`null`) is treated as NOT a manager, so nothing parent-shaped can flash
 * before `useAuth` has hydrated.
 */

export type MountainRole = "parent" | "child" | "pet" | null | undefined;

/** How a single mountain failed to open. */
export type MountainDetailFailure = "forbidden" | "unavailable";

export interface MountainStateCopy {
  title: string;
  description: string;
}

export interface MountainEmptyCopy extends MountainStateCopy {
  /** `null` ⇒ render no action at all. A viewer who cannot create gets none. */
  actionLabel: string | null;
}

/** The write gate on this page is parent-only; reads are not. */
export function canManageMountains(role: MountainRole): boolean {
  return role === "parent";
}

/**
 * What stands in for the money controls when the viewer cannot move money.
 * Empty ONLY for a parent whose controls are actually present — and empty is
 * never a safe thing to hand the UI here, so this returns the generic
 * explanation in that one case rather than a silent gap.
 */
export function readOnlyReason(role: MountainRole): string {
  if (role === "parent") {
    return "Only a grown-up can move money on a mountain, and this session can't. Ask a grown-up to make changes.";
  }
  return "🔒 Grown-ups move the money on a mountain — ask a grown-up to add to yours or take some out.";
}

/**
 * The lede under the title. The parent's line is a task ("Set goals…"); a
 * child's is a brief, because a child sets no goals here.
 */
export function headerSubtitle(role: MountainRole): string {
  return canManageMountains(role)
    ? "Set goals, save money, climb mountains!"
    : "Your savings, climbing one milestone at a time.";
}

/** Nothing saved yet. A child is told who sets goals up, not handed a dead CTA. */
export function emptyState(role: MountainRole): MountainEmptyCopy {
  if (canManageMountains(role)) {
    return {
      title: "No Savings Goals Yet",
      description:
        "Create your first savings goal and start climbing! Parents can match your deposits to help you reach the summit faster.",
      actionLabel: "Create Your First Mountain",
    };
  }
  return {
    title: "No Mountains Yet",
    description:
      "A grown-up sets savings goals up here. Ask a grown-up to start your first mountain.",
    actionLabel: null,
  };
}

/** The empty history must not instruct a viewer into a deposit they cannot make. */
export function emptyHistoryHint(role: MountainRole): string {
  return canManageMountains(role)
    ? "Add your first deposit to get started!"
    : "Grown-ups add the money — ask a grown-up to make your first deposit.";
}

/** The list read failed. Say it plainly, and say nothing is lost. */
export function loadError(role: MountainRole): MountainStateCopy {
  if (canManageMountains(role)) {
    return {
      title: "Unable to Load Mountains",
      description: "The savings goals didn't load this time. Try again.",
    };
  }
  return {
    title: "We couldn't load your mountains",
    description: "Nothing's lost — this one is just a hiccup. Try again, or ask a grown-up.",
  };
}

/**
 * A single mountain refused to open. `forbidden` is a real ownership refusal —
 * naming it is the truth, and it is the one case that must never degrade into a
 * silent no-op that leaves the pane saying "Select a mountain to view details"
 * forever.
 */
export function detailError(
  role: MountainRole,
  failure: MountainDetailFailure,
): MountainStateCopy {
  if (failure === "forbidden") {
    return {
      title: "That mountain isn't yours",
      description: canManageMountains(role)
        ? "This goal belongs to someone else, so it stays closed here."
        : "You can only open your own mountains. Ask a grown-up if you think that's wrong.",
    };
  }
  return {
    title: "That mountain wouldn't open",
    description: canManageMountains(role)
      ? "It didn't load this time. Try again."
      : "Nothing's lost — it just didn't load this time. Try again, or ask a grown-up.",
  };
}

/**
 * What a write refusal means, in a viewer's words — and whether it is one at
 * all. A 400 is the form's own business, so it returns `null` and the form
 * keeps showing its own message; only a genuine identity/role refusal takes the
 * page read-only, because that is the only thing that can be known to be true
 * about the viewer's permissions.
 *
 * `adult_only` and `unauthorized` are the server's own codes from
 * `requireLiveSession` (src/lib/server-auth.ts).
 */
export function writeDenialNotice(error: string | null | undefined): string | null {
  if (error === "adult_only") {
    return "🔒 Only a grown-up can add money or change a goal, so this page went read-only. Ask a grown-up to make changes.";
  }
  if (error === "unauthorized") {
    return "🔒 This page went read-only — sign in again to make changes.";
  }
  return null;
}