import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Prefixes that carry their own auth gate (CRON_SECRET bearer, admin
// pin/secret, alarm PIN, emergency PIN). /api/auth/* is exempt so an
// expired-cookie user can still POST /api/auth/logout and clear the
// httpOnly cookie; login/whoami enforce their own 401s at route level.
const API_EXEMPT = [
  "/api/auth/",
  "/api/cron/",
  "/api/admin/",
  "/api/ha/alarm",
  "/api/emergency",
];

export async function middleware(request: NextRequest) {
  // Keep the existing design-system preview rewrite working.
  if (request.nextUrl.pathname === "/_design-system") {
    return NextResponse.rewrite(new URL("/design-system", request.url));
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !API_EXEMPT.some((p) => pathname.startsWith(p))) {
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
