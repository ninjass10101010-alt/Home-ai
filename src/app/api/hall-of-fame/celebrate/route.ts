import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest, findMemberByName, namesMatch } from "@/lib/server-auth";
import { withAdmin } from "@/lib/pb-auth";

export const dynamic = "force-dynamic";

/**
 * Weekly-win ceremony claim (2026-09-16). The browser's normal write path
 * (`db.updateHallOfFameEntry` → /api/db/hall_of_fame) is PARENT-policy at the
 * gateway, so a kid claiming their own win from a child session would 403.
 * This route is the claim path instead:
 *
 * - A LIVE session required (the shared consuela_session cookie re-read
 *   against PocketBase, like /api/chat/messages POST).
 * - Ownership: child/pet sessions may celebrate ONLY their own win; parent
 *   sessions may claim for any member (a parent dismisses the modal for an
 *   absent kid).
 * - The target row must be a rank ≤ 3 hall_of_fame entry for that
 *   member+weekStart with a non-empty prize — else 404.
 * - Idempotent: re-claiming an already-celebrated row is a 200 no-op.
 *
 * C — both the parent allowlist and the ownership comparison read the LIVE row,
 * not the cookie's claim. A cookie role is a 7-day statement about the past, so
 * trusting it let a demoted parent keep claiming any member's win, and let a
 * renamed member's own entry fail the id comparison. `authorizeCurrentMemberRequest`
 * is the same helper the db-gateway routes use; it answers 401 with no
 * session or a vanished member and fails CLOSED with 503 on an outage.
 */
export async function POST(request: NextRequest) {
  const actor = await authorizeCurrentMemberRequest(request);
  if (!actor.ok) {
    return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status });
  }
  const actorId = String(actor.member?.id ?? actor.session?.memberId ?? "");
  const actorName = String(actor.member?.name ?? actor.session?.name ?? "");
  const actorRole = String(actor.member?.role ?? actor.session?.role ?? "");

  const body = await request.json().catch(() => ({}));
  const memberName = typeof body?.memberName === "string" ? body.memberName.trim() : "";
  const weekStart = typeof body?.weekStart === "string" ? body.weekStart.trim() : "";
  if (!memberName || !weekStart) {
    return NextResponse.json(
      { ok: false, error: "memberName and weekStart are required" },
      { status: 400 }
    );
  }

  const member = await findMemberByName(memberName);
  if (!member) {
    return NextResponse.json({ ok: false, error: "member_not_found" }, { status: 404 });
  }

  // Ownership gate — parents are the allowlist; child/pet sessions must be
  // claiming their OWN entry (live id match first, shared name matcher second).
  const isOwn =
    Boolean(actorId) && String(member.id) === actorId
      ? true
      : namesMatch(String(member.name || ""), actorName);
  if (actorRole !== "parent" && !isOwn) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const entry = await withAdmin(async (pb) => {
      const rows = await pb.collection("hall_of_fame").getFullList({ requestKey: null });
      const match =
        rows.find(
          (r: any) =>
            r.weekStart === weekStart &&
            Number(r.rank) >= 1 &&
            Number(r.rank) <= 3 &&
            typeof r.prize === "string" &&
            r.prize.length > 0 &&
            (r.member === member.name ||
              r.member === memberName ||
              namesMatch(String(r.member || ""), memberName))
        ) || null;
      if (!match) return null;
      // Already claimed — idempotent 200 without a redundant write.
      if (match.celebrated === true) return match;
      return pb.collection("hall_of_fame").update(match.id, { celebrated: true });
    });

    if (!entry) {
      return NextResponse.json(
        { ok: false, error: "no prized win for that member and week" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, entry });
  } catch {
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}
