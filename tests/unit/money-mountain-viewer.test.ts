/**
 * Money Mountain — who is looking, and what that viewer may do.
 *
 * `PATCH /api/money-mountain/[id]`, `POST /api/money-mountain` and the
 * transaction route are parent-only behind `requireLiveSession({ requireRole:
 * 'parent' })` (tests/unit/money-mountain-write-gate.test.ts), but
 * `nav-items.ts:141` deliberately lists `/money-mountain` for `SIGNED_IN_ROLES`
 * — the comment reads "Finance stays off the shared signed-out screen, like the
 * ledger", and a child watching their own mountain climb IS the feature. So the
 * page must not be hidden from a kid; it must be HONEST with one.
 *
 * This module is that honesty, in one place: which viewer may manage a
 * mountain, what replaces a missing control, and what every state says when
 * the read itself does not work. It is pure and client-safe on purpose — the
 * server-side `src/lib/money-mountain.ts` must never be imported into a page.
 */
import { describe, it, expect } from "vitest";
import {
  canManageMountains,
  readOnlyReason,
  headerSubtitle,
  emptyState,
  emptyHistoryHint,
  loadError,
  detailError,
  writeDenialNotice,
} from "@/components/money-mountain/viewer";

describe("money-mountain viewer — who may manage a mountain", () => {
  it("lets a parent manage the mountain", () => {
    expect(canManageMountains("parent")).toBe(true);
  });

  it("does not let a child or a pet manage the mountain", () => {
    expect(canManageMountains("child")).toBe(false);
    expect(canManageMountains("pet")).toBe(false);
  });

  it("treats an unresolved identity as NOT a manager", () => {
    // Before `useAuth` hydrates there is no role at all. Painting a parent's
    // "New Goal" against `null` is how a kid gets a control that 403s.
    expect(canManageMountains(null)).toBe(false);
    expect(canManageMountains(undefined)).toBe(false);
  });
});

describe("money-mountain viewer — a missing control is explained, never silent", () => {
  it("gives a child a real reason the money controls are missing", () => {
    expect(readOnlyReason("child")).toMatch(/grown-up/);
  });

  it("gives a pet the same reason", () => {
    expect(readOnlyReason("pet")).toMatch(/grown-up/);
  });

  it("explains the one case where a parent has no controls — a refused session", () => {
    // `readOnlyReason` never returns "": a parent with no controls (a write that
    // came back refused) must still get a reason, or the page would show a
    // silent gap where "Add Funds" used to be.
    expect(readOnlyReason("parent")).toMatch(/grown-up/);
  });
});

describe("money-mountain viewer — the header does not promise a child a goal they cannot set", () => {
  it("keeps the parent's imperative copy", () => {
    expect(headerSubtitle("parent")).toBe("Set goals, save money, climb mountains!");
  });

  it("gives a child a watching brief, not a task", () => {
    expect(headerSubtitle("child")).not.toBe(headerSubtitle("parent"));
    expect(headerSubtitle("child")).toMatch(/climb/i);
  });
});

describe("money-mountain viewer — the empty state", () => {
  it("offers a parent the create action", () => {
    expect(emptyState("parent").actionLabel).toBe("Create Your First Mountain");
  });

  it("offers a child NO create action and says who does set goals up", () => {
    const copy = emptyState("child");
    expect(copy.actionLabel).toBeNull();
    expect(copy.description).toMatch(/grown-up/);
  });

  it("keeps the parent's existing empty copy intact", () => {
    expect(emptyState("parent").title).toBe("No Savings Goals Yet");
  });
});

describe("money-mountain viewer — the empty history", () => {
  it("tells a parent to make the first deposit", () => {
    expect(emptyHistoryHint("parent")).toBe("Add your first deposit to get started!");
  });

  it("does not tell a child to do a deposit they cannot make", () => {
    expect(emptyHistoryHint("child")).toMatch(/grown-up/);
    expect(emptyHistoryHint("child")).not.toBe(emptyHistoryHint("parent"));
  });
});

describe("money-mountain viewer — a failed read says something true", () => {
  it("never shows a child the parent's 'Failed to load' copy", () => {
    for (const kind of ["forbidden", "unavailable"] as const) {
      const copy = detailError("child", kind);
      expect(`${copy.title} ${copy.description}`).not.toMatch(/failed to load/i);
      expect(loadError("child").description).not.toMatch(/failed to load/i);
    }
  });

  it("names the real reason on a 403: it is somebody else's mountain", () => {
    expect(detailError("child", "forbidden").title).toMatch(/isn't yours/i);
    expect(detailError("parent", "forbidden").title).toMatch(/isn't yours/i);
  });

  it("reassures a child that nothing is lost when a read simply fails", () => {
    expect(detailError("child", "unavailable").description).toMatch(/nothing.?s lost/i);
    expect(loadError("child").description).toMatch(/nothing.?s lost/i);
  });

  it("keeps the parent's list-error title for the parent", () => {
    expect(loadError("parent").title).toBe("Unable to Load Mountains");
  });
});

describe("money-mountain viewer — a write refused in flight", () => {
  it("explains a role refusal and goes read-only", () => {
    const notice = writeDenialNotice("adult_only");
    expect(notice).not.toBeNull();
    expect(notice).toMatch(/grown-up/);
  });

  it("explains an expired session", () => {
    expect(writeDenialNotice("unauthorized")).toMatch(/sign in/i);
  });

  it("does NOT treat an ordinary validation failure as a role denial", () => {
    // A 400 is the form's own business; flipping the page to read-only because
    // someone typed no name would be a lie about permissions.
    expect(writeDenialNotice("Name is required")).toBeNull();
    expect(writeDenialNotice(null)).toBeNull();
  });
});