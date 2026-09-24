// 2026-09-23 review (Important #2): the ledger is keyed by the roster's
// fullName everywhere (server normalizeMemberName prefers member.fullName;
// the leaderboard reads weekData.points[m.fullName]). But BOTH client
// fallback mappings built the PB-down roster with `fullName: m.name` — the
// fallback's declared fullName ("Caspian Garcia") was silently discarded in
// favor of the display name ("Caspian") — so any points recorded while PB
// was unreachable landed under a key the live roster never reads again.
// The fallback must carry the SAME fullName convention as live PB rows.
import { describe, it, expect } from "vitest";
import { db } from "@/db";
import { memberFallbacks } from "@/lib/member-fallback";

describe("member fallback roster — ledger-key alignment", () => {
  it("selectMembersFallback carries each fallback's DECLARED fullName (never the display name)", () => {
    const roster = db.selectMembersFallback();
    expect(roster.length).toBe(memberFallbacks.length);
    for (const fb of memberFallbacks) {
      const m: any = roster.find((r: any) => r.id === fb.id);
      expect(m, `fallback id ${fb.id}`).toBeTruthy();
      // name stays the FIRST-name display key…
      expect(m.name).toBe(fb.name.split(" ")[0]);
      // …but the ledger key is the declared fullName — the same key the
      // server's normalizeMemberName derives and the leaderboard reads.
      expect(m.fullName).toBe(fb.fullName);
    }
  });

  it("every declared fullName differs from its display name shape (the regression this pins)", () => {
    const caspian: any = db.selectMembersFallback().find((r: any) => r.name === "Caspian");
    expect(caspian.fullName).toBe("Caspian Garcia");
    expect(caspian.fullName).not.toBe("Caspian");
  });
});
