# Ledger Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Alex's finance ledger ("The Ledger") into the Consuela family dashboard as an adults-only Home widget + an embedded full page, with server-enforced parent-only access and zero changes to Alex's app.

**Architecture:** The dashboard's Next.js server proxies the `finance-dashboard` container (Alex's ledger app) under `/ledger-app/*`, `/assets/*`, `/api/data/*`, `/api/ofx/*` via declarative `rewrites()`, making the ledger same-origin with the dashboard (satisfying the ledger's `X-Frame-Options: SAMEORIGIN`). Middleware gates all ledger paths behind a parent session (`role !== "child"`). A new warm-glass Home widget summarizes balances from `GET /api/data/dashboard` and links to the full embed at `/ledger`.

**Tech Stack:** Next.js 16 (app router) + React 19, Vitest (jsdom via createRoot/act pattern), Playwright probe scripts, docker on QNAP NAS.

**Spec:** `docs/superpowers/specs/2026-09-02-ledger-integration-design.md` (contains the verified discovery table — read it first).

## Global Constraints

- Work happens in this repo (Home-ai submodule) on branch `warm-glass-v2`.
- **Zero changes** to Alex's app, `finance-dashboard` container config, nginx, or pipeline.
- Adults-only = valid `consuela_session` cookie AND `session.role !== "child"`. No PIN step-up (user decision 2026-09-02). The 30-min inactivity auto-logout is the shared-device net.
- Session role values are lowercase (`"parent"` / `"child"`); see `tests/unit/middleware-gate.test.ts` for the session-cookie test harness (`signSession`).
- Honest failure states only (no fabricated numbers); reduced-motion untouched; no new palette entries — the ledger widget tone is `#22c55e`.
- TDD: failing test → minimal implementation → passing test → commit, per task. `npm run typecheck` and `npm run lint` clean on touched files.
- `AGENTS.md` MUST be updated in the same session as UI/nav changes (repo rule) — folded into Task 6 (part of this plan, not an afterthought).
- Run a single test file with `npx vitest run tests/unit/<file>`; full suite with `npx vitest run`.

---

### Task 0: Commit the spec (housekeeping)

The spec file already exists but is untracked. Commit it first so review history is clean.

- [ ] **Step 1: Commit the spec**

```bash
cd /Users/garciafam/Documents/Dashboard/Home-ai
git add docs/superpowers/specs/2026-09-02-ledger-integration-design.md
git commit -m "docs(spec): ledger integration design (adults-only embed of Alex's finance dashboard)"
```

---

### Task 1: Ledger summary library (pure, tested)

**Files:**
- Create: `src/lib/finance/ledger-summary.ts`
- Test: `tests/unit/ledger-summary.test.ts`

**Interfaces:**
- Produces: `LedgerDashboardPayload`, `LedgerSummary`, `latestMonthKey(payload)`, `summarizeLedger(payload)`, `formatUSD(n)` — consumed by Task 4 (widget) and Task 5 (page uses only the fetch path, not the summary).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatUSD,
  latestMonthKey,
  summarizeLedger,
  type LedgerDashboardPayload,
} from "@/lib/finance/ledger-summary";

// Mirrors the live payload shape (verified on the NAS 2026-09-02):
// accounts[] carry type Checking|Savings|Loan; balanceSnapshots[] carry
// category Loan|Checking with mixed lastUpdated formats.
const PAYLOAD: LedgerDashboardPayload = {
  yearData: {
    "2026-08": {
      period: { monthLabel: "August", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 6400.0 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3000 },
      ],
      balanceSnapshots: [
        { name: "Older", category: "Loan", balance: 100, lastUpdated: "2026-08-01" },
      ],
    },
    "2026-09": {
      period: { monthLabel: "September", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 1234.56 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3816.18 },
        { name: "Huntington", type: "Checking", balance: 526.36 },
        { name: "LMCU Shares", type: "Savings", balance: 5248.57 },
        { name: "Tesla Loan", type: "Loan", balance: 44595.24 },
      ],
      balanceSnapshots: [
        { name: "Discover", category: "Loan", balance: 3488.63, lastUpdated: "2026-08-11" },
        { name: "Mortgage", category: "Loan", balance: 370194.62, lastUpdated: "8/31/2026" },
        { name: "LMCU Checking", category: "Checking", balance: 3816.18, lastUpdated: "8/31/2026" },
      ],
    },
  },
  selectedMonthKey: "2026-09",
};

describe("latestMonthKey", () => {
  it("picks the lexicographically largest YYYY-MM key", () => {
    expect(latestMonthKey(PAYLOAD)).toBe("2026-09");
  });
  it("returns null for an empty/missing yearData", () => {
    expect(latestMonthKey({})).toBeNull();
    expect(latestMonthKey({ yearData: {} })).toBeNull();
  });
});

describe("summarizeLedger", () => {
  it("computes cash/debt/spend for the latest month", () => {
    const s = summarizeLedger(PAYLOAD)!;
    expect(s.monthKey).toBe("2026-09");
    expect(s.monthLabel).toBe("September 2026");
    expect(s.cash).toBeCloseTo(9591.11);
    expect(s.debt).toBeCloseTo(373683.25); // Loan snapshots only (superset of accounts)
    expect(s.spent).toBe(1234.56);
    expect(s.budgeted).toBe(7712.84);
    expect(s.updatedLabel).toBe("8/31/2026"); // latest across both date formats
  });

  it("falls back to Loan-typed accounts when there are no Loan snapshots", () => {
    const p: LedgerDashboardPayload = {
      yearData: {
        "2026-09": {
          accounts: [
            { name: "Tesla Loan", type: "Loan", balance: 44595.24 },
            { name: "Checking", type: "Checking", balance: 10 },
          ],
        },
      },
    };
    expect(summarizeLedger(p)!.debt).toBe(44595.24);
    expect(summarizeLedger(p)!.updatedLabel).toBeNull();
  });

  it("returns null when there is no month data", () => {
    expect(summarizeLedger({ yearData: {} })).toBeNull();
  });

  it("tolerates a sparse month (missing ledger/accounts blocks)", () => {
    const s = summarizeLedger({ yearData: { "2026-01": {} } });
    expect(s).not.toBeNull();
    expect(s!.cash).toBe(0);
    expect(s!.debt).toBe(0);
    expect(s!.monthLabel).toBe("2026-01"); // key fallback when period labels missing
  });
});

describe("formatUSD", () => {
  it("formats whole dollars with commas, no decimals", () => {
    expect(formatUSD(9591.11)).toBe("$9,591");
    expect(formatUSD(0)).toBe("$0");
    expect(formatUSD(373683.25)).toBe("$373,683");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/ledger-summary.test.ts`
Expected: FAIL (module `@/lib/finance/ledger-summary` does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/finance/ledger-summary.ts`:

```ts
// Pure parsing + summarization for Alex's ledger payload, served by the
// finance-dashboard container at GET /api/data/dashboard and proxied
// same-origin through the Consuela dashboard. No React, no fetch — the
// widget imports these helpers so the math stays unit-testable.

export interface LedgerAccount {
  name: string;
  institution?: string;
  type?: string; // "Checking" | "Savings" | "Loan" | ...
  balance: number;
  delta?: number;
}

export interface LedgerBalanceSnapshot {
  name: string;
  category?: string; // "Loan" | "Checking" | ...
  balance: number;
  lastUpdated?: string; // "M/D/YYYY" or "YYYY-MM-DD"
}

export interface LedgerMonth {
  period?: { monthLabel?: string; yearLabel?: string };
  ledger?: { totalBudgeted?: number; totalSpent?: number };
  accounts?: LedgerAccount[];
  balanceSnapshots?: LedgerBalanceSnapshot[];
}

export interface LedgerDashboardPayload {
  yearData?: Record<string, LedgerMonth>;
  selectedMonthKey?: string;
}

export interface LedgerSummary {
  monthKey: string;
  monthLabel: string;
  cash: number;
  debt: number;
  spent: number;
  budgeted: number;
  updatedLabel: string | null;
}

/** Latest month = max "YYYY-MM" key (string sort is chronological for this shape). */
export function latestMonthKey(payload: LedgerDashboardPayload): string | null {
  const keys = Object.keys(payload?.yearData ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k));
  if (keys.length === 0) return null;
  return keys.sort()[keys.length - 1];
}

function parseSnapshotDate(s?: string): number | null {
  if (!s) return null;
  const trimmed = s.trim();
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  return null;
}

/** Most recent snapshot freshness label, tolerating both date formats. */
export function latestUpdatedLabel(snapshots: LedgerBalanceSnapshot[]): string | null {
  let best: { t: number; label: string } | null = null;
  for (const s of snapshots) {
    const t = parseSnapshotDate(s.lastUpdated);
    if (t !== null && (best === null || t > best.t)) best = { t, label: s.lastUpdated!.trim() };
  }
  return best?.label ?? null;
}

export function summarizeLedger(payload: LedgerDashboardPayload): LedgerSummary | null {
  const monthKey = latestMonthKey(payload);
  if (!monthKey) return null;
  const month = payload.yearData?.[monthKey] ?? {};
  const accounts = month.accounts ?? [];
  const snapshots = month.balanceSnapshots ?? [];

  const cash = accounts
    .filter((a) => a.type === "Checking" || a.type === "Savings")
    .reduce((sum, a) => sum + (a.balance || 0), 0);

  // Debt: prefer balance snapshots (superset — cards + loans); fall back to
  // Loan-typed accounts when no snapshots exist for the month.
  const debt = snapshots.some((s) => s.category === "Loan")
    ? snapshots
        .filter((s) => s.category === "Loan")
        .reduce((sum, s) => sum + (s.balance || 0), 0)
    : accounts
        .filter((a) => a.type === "Loan")
        .reduce((sum, a) => sum + (a.balance || 0), 0);

  const monthLabel =
    month.period?.monthLabel && month.period?.yearLabel
      ? `${month.period.monthLabel} ${month.period.yearLabel}`
      : monthKey;

  return {
    monthKey,
    monthLabel,
    cash,
    debt,
    spent: month.ledger?.totalSpent ?? 0,
    budgeted: month.ledger?.totalBudgeted ?? 0,
    updatedLabel: latestUpdatedLabel(snapshots),
  };
}

export function formatUSD(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/unit/ledger-summary.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/finance/ledger-summary.ts tests/unit/ledger-summary.test.ts
git commit -m "feat(ledger): pure summary helpers for Alex's ledger payload"
```

---

### Task 2: Middleware adult-only gate for ledger paths

**Files:**
- Modify: `src/middleware.ts`
- Test: `tests/unit/middleware-ledger-gate.test.ts` (new)

**Interfaces:**
- Consumes: `verifySession` / `SESSION_COOKIE` from `@/lib/session` (already imported by the middleware); `signSession({ memberId, name, role })` in tests (role is lowercase `"parent"`/`"child"`).
- Produces: `isAdultOnlyPath(pathname)` (exported for tests). Behavior: parent session → pass through; no session or `role === "child"` → `/ledger*` page paths redirect (307) to `/`; machine paths (`/assets/*`, `/api/data/*`, `/api/ofx/*`) → `403 { error: "adult_only" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/middleware-ledger-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, isAdultOnlyPath } from "../../src/middleware";
import { signSession, SESSION_COOKIE } from "../../src/lib/session";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const parentCookie = async () =>
  `${SESSION_COOKIE}=${await signSession({ memberId: "m1", name: "Rebecca", role: "parent" })}`;
const childCookie = async () =>
  `${SESSION_COOKIE}=${await signSession({ memberId: "m2", name: "Emily", role: "child" })}`;

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("isAdultOnlyPath", () => {
  it("covers the ledger page, proxy root, assets, and both api prefixes", () => {
    expect(isAdultOnlyPath("/ledger")).toBe(true);
    expect(isAdultOnlyPath("/ledger-app/")).toBe(true);
    expect(isAdultOnlyPath("/assets/index-VdJbasLh.js")).toBe(true);
    expect(isAdultOnlyPath("/api/data/dashboard")).toBe(true);
    expect(isAdultOnlyPath("/api/ofx/discover/preview")).toBe(true);
  });
  it("does not leak onto lookalike siblings", () => {
    expect(isAdultOnlyPath("/ledger-nav")).toBe(false);
    expect(isAdultOnlyPath("/assetsx")).toBe(false);
    expect(isAdultOnlyPath("/api/databases")).toBe(false);
    expect(isAdultOnlyPath("/api/tasks")).toBe(false);
  });
});

describe("ledger adult gate", () => {
  it("lets a parent load /ledger (passes through)", async () => {
    const res = await middleware(req("/ledger", await parentCookie()));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a guest from /ledger to /", async () => {
    const res = await middleware(req("/ledger"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$/);
  });

  it("redirects a child from /ledger to /", async () => {
    const res = await middleware(req("/ledger", await childCookie()));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$/);
  });

  it("403s a child on /ledger-app/ (iframe root)", async () => {
    const res = await middleware(req("/ledger-app/", await childCookie()));
    expect(res.status).toBe(403);
  });

  it("403s a guest on /assets/ (ledger bundles)", async () => {
    const res = await middleware(req("/assets/index-VdJbasLh.js"));
    expect(res.status).toBe(403);
  });

  it("403s a child on /api/data/dashboard with adult_only body", async () => {
    const res = await middleware(req("/api/data/dashboard", await childCookie()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
  });

  it("403s a guest on /api/ofx/discover/preview", async () => {
    const res = await middleware(req("/api/ofx/discover/preview"));
    expect(res.status).toBe(403);
  });

  it("lets a parent reach /api/data/dashboard and /assets/*", async () => {
    const cookie = await parentCookie();
    for (const path of ["/api/data/dashboard", "/api/ofx/discover/confirm", "/assets/index-x.css"]) {
      const res = await middleware(req(path, cookie));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("leaves unrelated routes on the existing rules", async () => {
    // guest /api/tasks still 401s on the generic session gate
    expect((await middleware(req("/api/tasks"))).status).toBe(401);
    // parent passes as before
    expect(
      (await middleware(req("/api/tasks", await parentCookie()))).headers.get("x-middleware-next")
    ).toBe("1");
    // non-API routes untouched
    expect((await middleware(req("/settings"))).headers.get("x-middleware-next")).toBe("1");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/middleware-ledger-gate.test.ts`
Expected: FAIL — `isAdultOnlyPath` is not exported by `src/middleware.ts`.

- [ ] **Step 3: Implement the gate**

In `src/middleware.ts`, after the existing `isExempt` block, add:

```ts
// Ledger integration (2026-09-02): Alex's finance app is proxied same-origin
// (see next.config.ts rewrites) and must be parent-only. Page paths bounce
// to Home; asset/api paths 403. Role comes from the HMAC-signed session.
const ADULT_ONLY_PREFIXES = ["/ledger", "/ledger-app", "/assets", "/api/data", "/api/ofx"];
const ADULT_ONLY_PAGE_PREFIXES = ["/ledger", "/ledger-app"];

export function isAdultOnlyPath(pathname: string): boolean {
  return ADULT_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAdultOnlyPage(pathname: string): boolean {
  return ADULT_ONLY_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
```

Then inside `middleware()`, immediately after the existing `_design-system` rewrite block (before the `/api/` gate), add:

```ts
  // Adult-only ledger paths — must run BEFORE the generic /api gate so
  // children get the honest 403 `adult_only` instead of a bare 401.
  if (isAdultOnlyPath(pathname)) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session || session.role === "child") {
      if (isAdultOnlyPage(pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return NextResponse.json({ error: "adult_only" }, { status: 403 });
    }
    return NextResponse.next();
  }
```

Finally extend the matcher:

```ts
export const config = {
  // note: "/ledger/:path*" with zero-or-more semantics matches "/ledger" itself
  matcher: ["/api/:path*", "/_design-system", "/ledger/:path*", "/ledger-app/:path*", "/assets/:path*"],
};
```

- [ ] **Step 4: Run new + existing middleware tests**

Run: `npx vitest run tests/unit/middleware-ledger-gate.test.ts tests/unit/middleware-gate.test.ts tests/unit/middleware-exempt.test.ts tests/unit/middleware-recipes.test.ts`
Expected: all PASS (the pre-existing suites must stay green — the new gate must not alter any existing behavior).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/middleware.ts tests/unit/middleware-ledger-gate.test.ts
git commit -m "feat(auth): middleware adult-only gate for ledger paths"
```

---

### Task 3: Same-origin proxy (`next.config.ts` rewrites)

**Files:**
- Modify: `next.config.ts`
- Test: `tests/unit/next-config-ledger-proxy.test.ts` (new)

**Interfaces:**
- Produces: four rewrite rules. Consumed by the runtime (not by other code).
- Env: `FINANCE_DASHBOARD_URL` — NAS value `http://finance-dashboard`; local dev default `http://192.168.0.28:9080` (the dev server runs on the Mac, which is on the LAN).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/next-config-ledger-proxy.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const mod = await import("../../next.config");
  return mod.default as {
    rewrites: () => Promise<Array<{ source: string; destination: string }>>;
  };
}

describe("ledger proxy rewrites", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("proxies the four ledger prefixes in order", async () => {
    const config = await loadConfig();
    const rules = await config.rewrites();
    expect(rules.map((r) => r.source)).toEqual([
      "/ledger-app/:path*",
      "/assets/:path*",
      "/api/data/:path*",
      "/api/ofx/:path*",
    ]);
  });

  it("defaults to the LAN URL and honors FINANCE_DASHBOARD_URL", async () => {
    let config = await loadConfig();
    let rules = await config.rewrites();
    expect(rules[0].destination).toBe("http://192.168.0.28:9080/:path*");
    expect(rules[2].destination).toBe("http://192.168.0.28:9080/api/data/:path*");

    vi.stubEnv("FINANCE_DASHBOARD_URL", "http://finance-dashboard");
    config = await loadConfig();
    rules = await config.rewrites();
    expect(rules[0].destination).toBe("http://finance-dashboard/:path*");
  });

  it("keeps the existing /more → /calendar redirect", async () => {
    const config = await loadConfig();
    const redirects = await (config as any).redirects();
    expect(redirects).toContainEqual({ source: "/more", destination: "/calendar", permanent: true });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/next-config-ledger-proxy.test.ts`
Expected: FAIL — `rewrites` is not a function on the config.

- [ ] **Step 3: Implement the rewrites**

Replace the whole of `next.config.ts` with:

```ts
import type { NextConfig } from "next";

// Alex's finance app ("The Ledger") is proxied same-origin so it can be
// framed inside /ledger (its nginx sends X-Frame-Options: SAMEORIGIN) and
// gated by middleware for parents only. NAS: http://finance-dashboard (the
// container joins familydashboard_consuela-net — see DEPLOY_NAS_LOCAL.md);
// local dev runs on the Mac, which reaches the published port directly.
const FINANCE_DASHBOARD_URL = process.env.FINANCE_DASHBOARD_URL ?? "http://192.168.0.28:9080";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async redirects() {
    return [
      {
        source: "/more",
        destination: "/calendar",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // The ledger SPA lives at its server root; /ledger-app/* is our mount.
      { source: "/ledger-app/:path*", destination: `${FINANCE_DASHBOARD_URL}/:path*` },
      // The app's absolute-path bundles and data calls (hashed build assets,
      // dashboard data, OFX statement import). Verified collision-free: this
      // app serves its own assets from /_next/static and never uses these.
      { source: "/assets/:path*", destination: `${FINANCE_DASHBOARD_URL}/assets/:path*` },
      { source: "/api/data/:path*", destination: `${FINANCE_DASHBOARD_URL}/api/data/:path*` },
      { source: "/api/ofx/:path*", destination: `${FINANCE_DASHBOARD_URL}/api/ofx/:path*` },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/unit/next-config-ledger-proxy.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add next.config.ts tests/unit/next-config-ledger-proxy.test.ts
git commit -m "feat(ledger): same-origin proxy rewrites to the finance dashboard"
```

---

### Task 4: Home widget + layout registration

**Files:**
- Create: `src/components/finance/LedgerWidget.tsx`
- Modify: `src/lib/layout-config.ts` (register widget id), `src/app/page.tsx` (auth-aware filtering + switch case)
- Test: `tests/unit/ledger-widget.test.tsx` (new)

**Interfaces:**
- Consumes: `summarizeLedger`, `formatUSD`, `LedgerDashboardPayload`, `LedgerSummary` from Task 1; `useAuth()` (`isParent`); `SectionCard` (`tone`, `icon`, `title`, `description`, `centeredHeader`, `className`, `footer`).
- Produces: `LedgerWidget({ className? })`; widget id `"financeLedger"` registered in layout config.

- [ ] **Step 1: Write the failing widget test**

Create `tests/unit/ledger-widget.test.tsx` (same jsdom + `createRoot`/`act` harness as `tests/unit/current-meal-widget.test.tsx`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import LedgerWidget from "@/components/finance/LedgerWidget";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let authState = { isParent: true };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

const PAYLOAD = {
  yearData: {
    "2026-09": {
      period: { monthLabel: "September", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 1234.56 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3816.18 },
        { name: "Huntington", type: "Checking", balance: 526.36 },
        { name: "LMCU Shares", type: "Savings", balance: 5248.57 },
      ],
      balanceSnapshots: [
        { name: "Discover", category: "Loan", balance: 3488.63, lastUpdated: "2026-08-11" },
        { name: "Mortgage", category: "Loan", balance: 370194.62, lastUpdated: "8/31/2026" },
      ],
    },
  },
};

function fetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => PAYLOAD }))
  );
}

describe("LedgerWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    authState = { isParent: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders cash, debt, month totals, and freshness for a parent", async () => {
    fetchOk();
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.textContent).toContain("The Ledger");
    expect(el.textContent).toContain("$9,591");   // cash
    expect(el.textContent).toContain("$373,683"); // debt
    expect(el.textContent).toContain("$1,235 of $7,713");
    expect(el.textContent).toContain("September 2026");
    expect(el.textContent).toContain("Balances as of 8/31/2026");
    // deep link to the embed page
    const link = Array.from(el.querySelectorAll("a[href='/ledger']"));
    expect(link.length).toBeGreaterThan(0);
  });

  it("renders nothing for non-parents and never fetches", async () => {
    authState = { isParent: false };
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.innerHTML).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows an honest error state and Try again recovers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => { throw new Error("down"); })
    );
    const el = render(<LedgerWidget />);
    await act(async () => {});
    expect(el.textContent).toContain("unreachable");

    fetchOk();
    const btn = Array.from(el.querySelectorAll("button")).find((b) =>
      /Try again/.test(b.textContent ?? "")
    )!;
    await act(async () => { btn.click(); });
    expect(el.textContent).toContain("$9,591");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/ledger-widget.test.tsx`
Expected: FAIL — `@/components/finance/LedgerWidget` does not exist.

- [ ] **Step 3: Implement the widget**

Create `src/components/finance/LedgerWidget.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SectionCard from "@/components/patterns/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import {
  formatUSD,
  summarizeLedger,
  type LedgerDashboardPayload,
  type LedgerSummary,
} from "@/lib/finance/ledger-summary";

type LoadState = "loading" | "ok" | "error";

export default function LedgerWidget({ className = "" }: { className?: string }) {
  const { isParent } = useAuth();
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [status, setStatus] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/data/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as LedgerDashboardPayload;
      const next = summarizeLedger(payload);
      if (!next) throw new Error("empty payload");
      setSummary(next);
      setStatus("ok");
    } catch {
      setSummary(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (isParent) void load();
  }, [isParent, load]);

  // Defense in depth — page.tsx also filters this widget out for
  // non-parents, so it never occupies a grid cell for kids/guests.
  if (!isParent) return null;

  return (
    <SectionCard
      tone="#22c55e"
      icon="📒"
      title="The Ledger"
      description="Family finances — tended by Alex"
      centeredHeader
      className={`h-full ${className}`}
      footer={
        status === "ok" ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {summary?.updatedLabel ? `Balances as of ${summary.updatedLabel}` : "\u00A0"}
            </span>
            <Link href="/ledger" className="tap-sm widget-accent-text font-semibold">
              Open The Ledger {"\u2192"}
            </Link>
          </div>
        ) : undefined
      }
    >
      {status === "loading" && (
        <div className="flex flex-1 flex-col justify-center gap-3" aria-busy="true">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-white/10" />
          <div className="h-8 w-1/2 animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-3/4 animate-pulse rounded-lg bg-white/5" />
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-text-secondary">The Ledger is unreachable right now.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="tap-sm rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-text-primary"
          >
            Try again
          </button>
        </div>
      )}
      {status === "ok" && summary && (
        <Link href="/ledger" className="tap group flex flex-1 flex-col justify-center gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Cash</p>
              <p className="text-2xl font-bold tabular-nums text-text-primary">{formatUSD(summary.cash)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Debt</p>
              <p className="text-2xl font-bold tabular-nums text-text-primary">{formatUSD(summary.debt)}</p>
            </div>
          </div>
          <p className="text-sm text-text-secondary">
            {summary.monthLabel}: {formatUSD(summary.spent)} of {formatUSD(summary.budgeted)} budgeted
          </p>
        </Link>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/unit/ledger-widget.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Register the widget in `src/lib/layout-config.ts`**

Five edits, all in that one file:

1. `WidgetId` union: add `| "financeLedger"`.
2. `ALL_WIDGETS`: append
   `{ id: "financeLedger", label: "The Ledger", emoji: "📒", description: "Parents only — family balances & budget (Alex)" },`
3. `WIDGET_TIERS`: append `financeLedger: { phone: "", tablet: "col-span-1", desktop: "" },`.
4. `PHONE_DEFAULT_WIDGETS`: append `"financeLedger"` at the end.
5. `WIDGET_SPANS`: append `financeLedger: "col-span-1",` and add `"financeLedger"` to the end of the `DEFAULT_LAYOUT.desktop.widgets` array.

Then fix the frozen expectations in `tests/unit/layout-config.test.ts` — every hard-coded expected widget order/count gains `"financeLedger"` (phone + tablet: appended after `"homeLights"`; desktop: appended at the end of the desktop list; `ALL_WIDGETS` length assertions +1). Run to see each failing assertion and update to the new expected arrays:

Run: `npx vitest run tests/unit/layout-config.test.ts`
Expected: FAIL until expectations updated, then all PASS.

- [ ] **Step 6: Wire into `src/app/page.tsx`**

Three edits:

1. Extend the auth destructure (~line 105) to include `isParent`:
   `const { currentUser, isLoggedIn, isParent, logout, sessionRemainingMs, sessionWarning, extendSession } = useAuth();`
2. Add the import: `import LedgerWidget from "@/components/finance/LedgerWidget";`
3. Find where the widget list is mapped (search for `visibleWidgets.map`). Immediately before/above that computation, add role filtering so the widget never leaves an empty grid cell for kids/guests, and use the filtered list for BOTH the `.map(` source and the `tabletSpanFor(id, index, ...)` third argument:

```tsx
// The Ledger is parents-only — filtered out entirely (not a hollow cell).
const homeWidgets = isParent ? visibleWidgets : visibleWidgets.filter((w) => w.id !== "financeLedger");
```

(If `visibleWidgets` entries are used anywhere else for rendering, apply the same list there too.)

4. Add the switch case (alongside the other cases, before `default`):

```tsx
                case "financeLedger":
                  return <div key="financeLedger" className={span}><LedgerWidget className="h-full" /></div>;
```

- [ ] **Step 7: Verify + commit**

```bash
npx vitest run tests/unit/ledger-widget.test.tsx tests/unit/layout-config.test.ts
npm run typecheck
npm run lint -- src/components/finance/LedgerWidget.tsx src/lib/layout-config.ts src/app/page.tsx
git add src/components/finance/LedgerWidget.tsx src/lib/layout-config.ts src/app/page.tsx tests/unit/ledger-widget.test.tsx tests/unit/layout-config.test.ts
git commit -m "feat(home): parents-only Ledger widget (cash / debt / month + deep link)"
```

---

### Task 5: `/ledger` embed page

**Files:**
- Create: `src/app/ledger/page.tsx`
- Test: `tests/unit/ledger-page.test.tsx` (new)

**Interfaces:**
- Consumes: `useAuth()` (`isParent`), `PageShell`, `PageHeader`, middleware gate from Task 2, proxy from Task 3.
- Produces: route `/ledger` rendering the same-origin iframe at `/ledger-app/`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import LedgerPage from "@/app/ledger/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let authState = { isParent: true };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
// PageShell renders CapsuleNav (next/navigation); stub both minimally.
vi.mock("next/navigation", () => ({
  usePathname: () => "/ledger",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe("LedgerPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    authState = { isParent: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parent + healthy upstream → iframe pointed at /ledger-app/", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    const el = render(<LedgerPage />);
    await act(async () => {});
    const iframe = el.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/ledger-app/");
    expect(el.textContent).toContain("The Ledger");
  });

  it("child → locked state, no iframe, no fetch", async () => {
    authState = { isParent: false };
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const el = render(<LedgerPage />);
    await act(async () => {});
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("parents only");
    expect(spy).not.toHaveBeenCalled();
  });

  it("parent + upstream down → honest error + Try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502 })));
    const el = render(<LedgerPage />);
    await act(async () => {});
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("unreachable");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/ledger-page.test.tsx`
Expected: FAIL — `@/app/ledger/page` does not exist.

- [ ] **Step 3: Implement the page**

Create `src/app/ledger/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import { useAuth } from "@/hooks/useAuth";

type FrameState = "checking" | "ready" | "error";

const subscribeNoop = () => () => {};

export default function LedgerPage() {
  const { isParent } = useAuth();
  // SSR renders the deterministic "checking" frame; mounted clients resolve
  // auth and the upstream health check (middleware is the real gate).
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [frame, setFrame] = useState<FrameState>("checking");

  const check = useCallback(async () => {
    setFrame("checking");
    try {
      const res = await fetch("/api/data/dashboard", { cache: "no-store" });
      setFrame(res.ok ? "ready" : "error");
    } catch {
      setFrame("error");
    }
  }, []);

  useEffect(() => {
    if (mounted && isParent) void check();
  }, [mounted, isParent, check]);

  return (
    <PageShell>
      <PageHeader
        title="The Ledger"
        subtitle="Alex's finance tracker — parents only"
        icon="📒"
        action={
          <a
            href="/ledger-app/"
            target="_blank"
            rel="noopener noreferrer"
            className="tap-sm rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-text-secondary"
          >
            Open full size ↗
          </a>
        }
      />
      <div className="px-4 pb-6">
        {!mounted || (isParent && frame === "checking") ? (
          <div className="grid h-[calc(100dvh-220px)] place-items-center rounded-3xl border border-white/10 bg-white/5">
            <p className="text-sm text-text-secondary">{mounted ? "Opening The Ledger…" : "\u00A0"}</p>
          </div>
        ) : !isParent ? (
          <div className="grid place-items-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
            <div className="text-4xl">🔒</div>
            <p className="mt-3 text-sm text-text-secondary">
              The Ledger is for parents only — ask Mom or Dad to sign in.
            </p>
          </div>
        ) : frame === "error" ? (
          <div className="grid place-items-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
            <div className="text-4xl">📒</div>
            <p className="mt-3 text-sm text-text-secondary">The Ledger is unreachable right now.</p>
            <button
              type="button"
              onClick={() => void check()}
              className="tap-sm mt-4 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-text-primary"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#f8f5ef]">
            <iframe
              src="/ledger-app/"
              title="The Ledger — Alex's finance tracker"
              className="block h-[calc(100dvh-220px)] w-full"
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/unit/ledger-page.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck
npm run lint -- src/app/ledger/page.tsx
git add src/app/ledger/page.tsx tests/unit/ledger-page.test.tsx
git commit -m "feat(ledger): /ledger embed page with locked + unreachable states"
```

---

### Task 6: Env, compose, and documentation wiring

**Files:**
- Modify: `docker-compose.yml`, `../docker-compose.yml` (outer repo root), `.env.example`, `DEPLOY_NAS_LOCAL.md`, `AGENTS.md`
- Modify (outer repo): `../PRODUCT.md`

No unit tests for docs; verify by inspection + grep at the end of the task.

- [ ] **Step 1: Add `FINANCE_DASHBOARD_URL` to both compose files**

In `Home-ai/docker-compose.yml`, in the `environment:` list right after the `HERMES_API_URL` line, add:

```yaml
      - FINANCE_DASHBOARD_URL=http://finance-dashboard
```

Make the identical addition in the outer repo's `/Users/garciafam/Documents/Dashboard/docker-compose.yml` (same `environment:` list).

- [ ] **Step 2: Document the env var in `.env.example`**

After the `HERMES_API_URL` line add:

```
# Alex's finance app (The Ledger) — proxied at /ledger-app, /assets, /api/data, /api/ofx.
# NAS value: http://finance-dashboard (container on familydashboard_consuela-net).
# Local dev runs on the Mac, which reaches the published port directly:
FINANCE_DASHBOARD_URL=http://192.168.0.28:9080
```

- [ ] **Step 3: Add a gotcha to `DEPLOY_NAS_LOCAL.md`**

Append under the gotchas section:

```markdown
### Gotcha #14 — Ledger embed 403s/502s after a finance-dashboard recreate

`/ledger` proxies to `http://finance-dashboard/*` — the container must share the
dashboard network (the QNAP times out on container→host-IP traffic):

```sh
docker network connect familydashboard_consuela-net finance-dashboard
```

Re-run after ANY recreation of the finance-dashboard container (connecting an
already-connected network errors harmlessly). The dashboard env also needs
`FINANCE_DASHBOARD_URL=http://finance-dashboard` (add to `/tmp/new.env` when
swapping containers per the standard runbook).
```

- [ ] **Step 4: AGENTS.md updates (repo rule — same session)**

Three additions to `AGENTS.md`:

1. New **Current Dashboard Snapshot** bullet (top of that section):

```markdown
- **Last Updated:** 2026-09-02 | **Alex's Ledger is embedded in the dashboard — parents only.** The finance app Alex maintains ("The Ledger", container `finance-dashboard`, port 9080 on the NAS) is now proxied same-origin through the dashboard (`/ledger-app/*`, `/assets/*`, `/api/data/*`, `/api/ofx/*` → `FINANCE_DASHBOARD_URL`) and embedded at the new `/ledger` page. Parents see a new Home widget ("The Ledger 📒", money-green `#22c55e` — Cash / Debt / this-month budget + freshness, tap to open); kids and guests never see the widget, and middleware gates every ledger path (`/ledger*` pages redirect to Home; `/assets/*` + `/api/data/*` + `/api/ofx/*` return 403 `adult_only`). No PIN step-up by design; the 30-min auto-logout covers shared devices. The ledger app itself is untouched; the only ops requirement is `docker network connect familydashboard_consuela-net finance-dashboard` (DEPLOY_NAS_LOCAL.md gotcha #14). Spec `docs/superpowers/specs/2026-09-02-ledger-integration-design.md`; plan `docs/superpowers/plans/2026-09-02-ledger-integration.md`.
```

2. New **UI Change Record** entry (copy-ready format, at the top of that section):

```markdown
### UI Change Record — 2026-09-02 — The Ledger: parents-only Home widget + embedded page
- Added / Changed: `src/components/finance/LedgerWidget.tsx` (NEW — warm-glass SectionCard, tone `#22c55e`, 📒 protruding icon, Cash/Debt stat pair + "September 2026: $x of $y budgeted" line, "Balances as of …" freshness + "Open The Ledger →" footer link; loading skeleton + honest unreachable state with Try again), `src/app/ledger/page.tsx` (NEW — PageHeader + rounded full-height iframe at `/ledger-app/`, "Open full size ↗" header action, 🔒 locked state for non-parents, unreachable state), `src/middleware.ts` (adult-only gate), `next.config.ts` (proxy rewrites), `src/lib/layout-config.ts` + `src/app/page.tsx` (widget `financeLedger` registered; filtered out of the widget list for non-parents so it never leaves an empty cell).
- Visual / Motion: Standard widget-card language; no new motion; `prefers-reduced-motion` untouched. Kids/guests see no trace of the feature.
- Color sources: new per-widget tone `#22c55e` (money green) via `--widget-tone`; everything else existing tokens.
- Agent action required: Update this section + "Current Dashboard Snapshot" + Change Log. Note: port 9080 remains open on the LAN by design — the gate covers access THROUGH the dashboard only.
- User-facing description (copy-paste ready for responses):
  > "The Ledger is part of the dashboard now. When Mom or Dad is signed in, the Home screen has a card showing cash, debt, and this month's budget, and tapping it opens the full Ledger right inside the dashboard — same app Alex keeps, same look. Kids and signed-out visitors never see it."
```

3. New **Common Journey**:

```markdown
**"Where is the family ledger?"**
Sign in as a parent. On Home, tap the green **The Ledger 📒** card (cash / debt / this month) — it opens the full Ledger inside the dashboard. Kids and guests don't see the card or the page.
```

Also add a dated line to the **Change Log** at the bottom (summary of the above in the existing style).

- [ ] **Step 5: PRODUCT.md surface mention**

In `../PRODUCT.md`, extend the "Surfaces:" line's parenthetical so the More/tools enumeration ends with "…, and The Ledger (parents-only embedded finance view from Alex's app)". Keep the sentence structure intact otherwise.

- [ ] **Step 6: Verify + commit**

```bash
grep -n "FINANCE_DASHBOARD_URL" docker-compose.yml ../docker-compose.yml .env.example
grep -n "Gotcha #14" DEPLOY_NAS_LOCAL.md
grep -n "Ledger" AGENTS.md | head -8
npx vitest run   # full suite green
npm run typecheck
# Home-ai repo (submodule) files:
git add docker-compose.yml .env.example DEPLOY_NAS_LOCAL.md AGENTS.md
git commit -m "docs+ops(ledger): compose env, deploy gotcha #14, AGENTS.md snapshot/records"
# Outer repo files are committed separately (Home-ai is a submodule of it):
cd /Users/garciafam/Documents/Dashboard
git add docker-compose.yml PRODUCT.md
git commit -m "docs+ops(ledger): compose FINANCE_DASHBOARD_URL + PRODUCT surface note"
cd Home-ai
```

---

### Task 7: Live verification on the NAS

**Files:**
- Create: `scripts/consuela/verify-ledger-integration.mjs`

This task runs against the live NAS. Read `DEPLOY_NAS_LOCAL.md` first and follow it exactly for the deploy portion. The tarball sync, docker build, and container swap are ops actions — confirm with the user before running them.

- [ ] **Step 1: Attach the ledger container to the dashboard network**

```bash
sshpass -p "$NAS_PASS" ssh admin@192.168.0.28 \
  'export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:$PATH; \
   docker network connect familydashboard_consuela-net finance-dashboard'
```

("already exists"-style errors are harmless — the command is idempotent in effect.)

- [ ] **Step 2: Deploy the dashboard per the runbook**

Follow `DEPLOY_NAS_LOCAL.md` exactly (tar sync → docker build with `--build-arg NEXT_PUBLIC_PB_URL=http://pocketbase:8090` → container swap). The container-swap env (`/tmp/new.env`) must now include `FINANCE_DASHBOARD_URL=http://finance-dashboard` in addition to everything the runbook already sets.

- [ ] **Step 3: Smoke: container reachability + gates**

```bash
# dashboard container can now resolve the ledger by name:
sshpass -p "$NAS_PASS" ssh admin@192.168.0.28 \
  'export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:$PATH; \
   docker exec consuela-dashboard wget -qO- http://finance-dashboard/health'
# expect: healthy

# guest gates (no cookie):
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.28:3000/ledger              # expect 307
curl -s -w "\n%{http_code}\n" http://192.168.0.28:3000/api/data/dashboard | tail -2 # expect adult_only + 403
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.28:3000/assets/index-x.js   # expect 403

# parent session:
curl -s -c /tmp/ledger-cookie.txt -X POST http://192.168.0.28:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"memberName":"<real parent first name>","pin":"<their pin>"}' | head -c 200   # expect 200
curl -s -b /tmp/ledger-cookie.txt -o /dev/null -w "%{http_code}\n" http://192.168.0.28:3000/ledger  # expect 200
curl -s -b /tmp/ledger-cookie.txt http://192.168.0.28:3000/api/data/dashboard | head -c 120         # expect JSON with "yearData"
curl -s -b /tmp/ledger-cookie.txt -o /dev/null -w "%{http_code}\n" http://192.168.0.28:3000/ledger-app/  # expect 200 (proxied HTML)

# child session: same flow with a child's PIN, then /ledger must be 307 and /api/data/dashboard 403.
```

- [ ] **Step 4: Write the Playwright probe**

Create `scripts/consuela/verify-ledger-integration.mjs` (uses the repo's existing Playwright dev-dependency; pattern from `scripts/consuela/verify-emergency-settings.mjs`):

```js
// Verify the Ledger integration end-to-end against the live NAS dashboard.
// Usage: PARENT_PIN=#### CHILD_PIN=#### node scripts/consuela/verify-ledger-integration.mjs
import { chromium } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://192.168.0.28:3000";
const PARENT = { name: process.env.PARENT_NAME ?? "Rebecca", pin: process.env.PARENT_PIN };
const CHILD = { name: process.env.CHILD_NAME ?? "Emily", pin: process.env.CHILD_PIN };

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { failures++; console.error(`❌ ${name}: ${e.message}`); }
}

async function loginCookie(member) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberName: member.name, pin: member.pin }),
  });
  if (!res.ok) throw new Error(`login failed for ${member.name}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/consuela_session=([^;]+)/);
  if (!m) throw new Error("no session cookie in login response");
  return m[1];
}

function guest() {
  return fetch;
}

const browser = await chromium.launch();

async function authedContext(cookieValue) {
  const ctx = await browser.newContext();
  const url = new URL(BASE);
  await ctx.addCookies([{ name: "consuela_session", value: cookieValue, domain: url.hostname, path: "/" }]);
  return ctx;
}

// --- anonymous gates (plain fetch) ---
await check("guest /ledger redirects to /", async () => {
  const res = await fetch(`${BASE}/ledger`, { redirect: "manual" });
  if (res.status !== 307) throw new Error(`got ${res.status}`);
});
await check("guest /api/data/dashboard 403s adult_only", async () => {
  const res = await fetch(`${BASE}/api/data/dashboard`);
  if (res.status !== 403) throw new Error(`got ${res.status}`);
});
await check("guest /assets/* 403s", async () => {
  const res = await fetch(`${BASE}/assets/index-x.js`);
  if (res.status !== 403) throw new Error(`got ${res.status}`);
});

// --- parent experience ---
const parentCookie = await loginCookie(PARENT);
await check("parent /ledger returns 200", async () => {
  const res = await fetch(`${BASE}/ledger`, { headers: { cookie: `consuela_session=${parentCookie}` } });
  if (res.status !== 200) throw new Error(`got ${res.status}`);
});
await check("parent /ledger-app/ proxies the ledger HTML", async () => {
  const res = await fetch(`${BASE}/ledger-app/`, { headers: { cookie: `consuela_session=${parentCookie}` } });
  const html = await res.text();
  if (!html.includes("The Ledger")) throw new Error("ledger HTML missing title");
});
await check("parent /api/data/dashboard returns yearData", async () => {
  const res = await fetch(`${BASE}/api/data/dashboard`, { headers: { cookie: `consuela_session=${parentCookie}` } });
  const json = await res.json();
  if (!json.yearData) throw new Error("no yearData");
});

{
  const ctx = await authedContext(parentCookie);
  const page = await ctx.newPage();
  await check("Home shows The Ledger card for parent", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=The Ledger", { timeout: 15000 });
  });
  await check("/ledger page mounts the iframe", async () => {
    await page.goto(`${BASE}/ledger`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("iframe[src='/ledger-app/']", { timeout: 15000 });
    await page.waitForSelector("text=Open full size", { timeout: 5000 });
  });
  await ctx.close();
}

// --- child experience ---
const childCookie = await loginCookie(CHILD);
await check("child /ledger redirects to /", async () => {
  const res = await fetch(`${BASE}/ledger`, { headers: { cookie: `consuela_session=${childCookie}` }, redirect: "manual" });
  if (res.status !== 307) throw new Error(`got ${res.status}`);
});
{
  const ctx = await authedContext(childCookie);
  const page = await ctx.newPage();
  await check("Home hides The Ledger card for child", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); // allow widget hydration
    if (await page.locator("text=The Ledger").count()) throw new Error("widget visible to child");
  });
  await ctx.close();
}

await browser.close();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll Ledger integration checks passed.");
```

> Note: the child name/pin must be a real child member ("Emily" by default; override with `CHILD_NAME`/`CHILD_PIN`). Never commit real PINs — they stay in the environment of the run.

- [ ] **Step 5: Run the probe**

```bash
PARENT_PIN='<real parent pin>' CHILD_PIN='<real child pin>' \
  node scripts/consuela/verify-ledger-integration.mjs
```
Expected: all checks pass. Also confirm in a real browser: parent sign-in → Home shows the green Ledger card with real family totals → tap → the full Ledger (magazine UI) renders inside the dashboard → statement import (OFX) still functions through the embed.

Also confirm kids never see it: sign in as a child — Home has no Ledger card, tapping `192.168.0.28:3000/ledger` manually bounces back Home.

- [ ] **Step 6: Commit the probe**

```bash
git add scripts/consuela/verify-ledger-integration.mjs
git commit -m "test(ledger): live Playwright probe for the embedded ledger + adult gates"
```

---

## Self-review notes (completed against the spec)

- **Spec coverage:** §4 architecture → Tasks 3+7; §5 access control → Task 2 (+ page/widget client gates in 4/5); §6.1 widget → Task 4; §6.2 embed page → Task 5; §6.3 entry points → Task 4 filter (no capsule item); §7 file list → Tasks 1–6 cover every row; §8 tests → one test file per task + probe; §9 rollout → Task 7. The only spec item with no code task is the honest-limitation note (documentation — folded into AGENTS.md Change Record in Task 6).
- **Placeholders:** probe script needs real parent/child PINs at runtime (env-gated, never committed — called out inline); everything else is complete code.
- **Type consistency:** `LedgerSummary` fields (`cash/debt/spent/budgeted/monthLabel/updatedLabel`) identical between Task 1 producer and Task 4 consumer; widget/page fetch path `/api/data/dashboard` matches the Task 2/3 prefixes; `isParent` verified present in `useAuth` (`src/hooks/useAuth.tsx`).
- **Risk to watch:** if `layout-config.test.ts` asserts derived orders (e.g. tablet parity), adding a 13th (odd) widget changes last-widget stretch behavior — Task 4 Step 5 handles by updating frozen expectations after reading the failures.
