import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieClearOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(_request: Request) {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieClearOptions());
  return res;
}
