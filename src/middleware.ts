import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Prefixes that carry their own auth gate (CRON_SECRET bearer, admin
// pin/secret, alarm PIN, emergency PIN). /api/auth/* is exempt so an
// expired-cookie user can still POST /api/auth/logout and clear the
// httpOnly cookie; login/whoami enforce their own 401s at route level.
// /api/recipes/* is a public TheMealDB catalog lookup (no family data),
// so guests can search recipes without a session.
const API_EXEMPT = [
  "/api/auth/",
  "/api/cron/",
  "/api/admin/",
  "/api/ha/alarm",
  "/api/emergency",
  "/api/recipes/",
  "/api/hermes/",
  "/api/consuela/suggestions",
  "/api/consuela/briefing",
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
const ADULT_ONLY_PREFIXES = ["/ledger", "/ledger-app", "/assets", "/api/data", "/api/ofx"];
const ADULT_ONLY_PAGE_PREFIXES = ["/ledger"];

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
  // ALLOWLIST on `parent`: the roster has a third role `pet` (default PIN
  // 0000, login-unfiltered), so denying only `child` would let a pet session
  // read the whole ledger. Only `parent` passes; child/pet/unknown all denied.
  if (isAdultOnlyPath(pathname)) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session || session.role !== "parent") {
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

  if (pathname.startsWith("/api/") && !isExempt(pathname)) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // note: "/ledger/:path*" with zero-or-more semantics matches "/ledger" itself
  matcher: ["/api/:path*", "/_design-system", "/ledger/:path*", "/ledger-app/:path*", "/assets/:path*"],
};
