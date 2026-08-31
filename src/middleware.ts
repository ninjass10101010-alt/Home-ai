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

export async function middleware(request: NextRequest) {
  // Keep the existing design-system preview rewrite working.
  if (request.nextUrl.pathname === "/_design-system") {
    return NextResponse.rewrite(new URL("/design-system", request.url));
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !isExempt(pathname)) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/_design-system"],
};
