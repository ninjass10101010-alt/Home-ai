import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { requireLiveSession } from "@/lib/server-auth";

// Prefixes that carry their own auth gate (CRON_SECRET bearer, admin
// pin/secret, alarm PIN, emergency PIN). /api/auth/* is exempt so an
// expired-cookie user can still POST /api/auth/logout and clear the
// httpOnly cookie; login/whoami enforce their own 401s at route level.
// /api/recipes/search is a public TheMealDB catalog lookup (no family data),
// so guests can search recipes without a session. F8e narrowed this from the
// whole /api/recipes/ prefix: /api/recipes/ingest performs a server-side fetch
// of an arbitrary URL and must require a session.
const API_EXEMPT = [
  "/api/auth/",
  "/api/cron/",
  "/api/admin/",
  "/api/ha/alarm",
  "/api/emergency",
  "/api/recipes/search",
  "/api/hermes/",
  "/api/consuela/suggestions",
  "/api/consuela/screensaver",
  // MUSE inbound identity — the surface self-authenticates with a bearer
  // token minted by /api/muse/auth/login (key → expiring token). The settings
  // routes added in Task 11 gate themselves on a session and are NOT covered.
  "/api/muse/",
  // PIN-gated task actions. All routes self-authenticate: the member PIN is
  // the credential (verified server-side against PB, throttled against brute
  // force) — the same trust model as /api/auth/login. Without the exemption a
  // GUEST device (the kitchen display auto-logs-out after 30 min) 401s at the
  // middleware before the PIN is ever checked, so an assigned-chore completion
  // or undo could never land server-side and points never propagated — the
  // "family completes tasks but points don't show" bug.
  "/api/tasks/claim",
  "/api/tasks/approve",
  // Parent-PIN gated ledger command (penalty / manual adjust). Like the
  // approval route it self-authenticates on the member PIN so a guest device
  // can never reach it, and it hard-requires role === "parent".
  "/api/tasks/ledger",
  // Reward redemption self-authenticates the member's PIN (and the parent PIN
  // over 100pts) against PB server-side, the same trust model as the claim
  // route above. Without the exemption a guest or auto-logged-out device 401s
  // at the middleware before the PIN is ever checked, so a kid's redemption
  // could never land and the points would never move.
  "/api/rewards/redeem",
  "/api/members/verify",
];

// MF-5 — exact-match OR trailing-slash semantics. Plain startsWith(p) made
// the /api/emergency exemption also cover its EXISTING sibling
// /api/emergency-contacts (read-only contact roster), leaving that route
// unauthenticated.
export function isExempt(pathname: string): boolean {
  return API_EXEMPT.some((p) => {
    const base = p.endsWith("/") ? p.slice(0, -1) : p;
    return base === pathname || pathname.startsWith(base + "/");
  });
}

// Ledger integration (2026-09-02): Alex's finance app is proxied same-origin
// (see next.config.ts rewrites) and must be parent-only. Page paths bounce
// to Home; asset/api paths 403. Role comes from the HMAC-signed session.
// /ledger-app is the iframe root (a machine path, like /assets) — it 403s
// rather than redirecting, so a child's iframe never loads Home.
// F2 — /memory (the family memory bank browser) joined the adult allowlist:
// the bank carries allergies/preferences/addresses; a signed-in child or a
// pet session must never read or edit it. Page path → redirect to Home.
const ADULT_ONLY_PREFIXES = ["/ledger", "/ledger-app", "/assets", "/api/data", "/api/ofx", "/memory"];
const ADULT_ONLY_PAGE_PREFIXES = ["/ledger", "/memory"];

export function isAdultOnlyPath(pathname: string): boolean {
  return ADULT_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAdultOnlyPage(pathname: string): boolean {
  return ADULT_ONLY_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  // Keep the existing design-system preview rewrite working.
  if (request.nextUrl.pathname === "/_design-system") {
    return NextResponse.rewrite(new URL("/design-system", request.url));
  }

  const { pathname } = request.nextUrl;

  // Adult-only ledger paths — must run BEFORE the generic /api gate so
  // non-adults get the honest 403 `adult_only` instead of a bare 401.
  // PARENT ALLOWLIST on the LIVE role: the roster has a third role `pet`
  // (default PIN 0000, login-unfiltered), so denying only `child` would let a
  // pet session read the whole ledger. Only `parent` passes; child/pet/unknown
  // all denied.
  //
  // C — the role is re-read from PocketBase, not read off the cookie. The
  // cookie's role is an HMAC-signed claim with a 7-day TTL and NO revocation,
  // so trusting it left a demoted parent (or a removed one) holding the entire
  // finance surface — the proxied app, its `/assets/*` bundles, `/api/data/*`
  // and `/api/ofx/*` — until the cookie expired. `requireLiveSession` is the
  // same helper and the same `requireRole:"parent"` seam /api/admin/*,
  // /api/consuela/planner/apply and the chat planner use, and it FAILS CLOSED:
  // a member whose live row is gone is 401/403, and a PocketBase outage is a
  // 503 `identity_unavailable` — never "unverified, so probably a parent".
  if (isAdultOnlyPath(pathname)) {
    const live = await requireLiveSession(request, { requireRole: "parent" });
    if (!live.ok) {
      if (isAdultOnlyPage(pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      }
      // `identity_unavailable` is its own honest status so a PocketBase blip
      // never reads as "you lost access".
      return NextResponse.json(
        { error: live.error },
        { status: live.status === 503 ? 503 : 403 },
      );
    }
    return NextResponse.next();
  }

  if (pathname === "/api/emergency/test") {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/") && !isExempt(pathname)) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // The adult-only gate reads the LIVE PocketBase identity (requireLiveSession →
  // node:crypto + the PocketBase SDK), which the edge runtime cannot run, so
  // this file is pinned to Node.js. Next 16 only forbids a `runtime` export in
  // a `proxy.ts`; a `middleware.ts` takes it (stable since 15.5), and 16's own
  // proxy runs on Node.js by default anyway.
  runtime: "nodejs",
  // note: "/ledger/:path*" with zero-or-more semantics matches "/ledger" itself
  matcher: ["/api/:path*", "/_design-system", "/ledger/:path*", "/ledger-app/:path*", "/assets/:path*", "/memory/:path*"],
};
