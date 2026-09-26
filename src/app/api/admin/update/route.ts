import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status ?? 401 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "manual_deploy_required",
    },
    { status: 410 },
  );
}
