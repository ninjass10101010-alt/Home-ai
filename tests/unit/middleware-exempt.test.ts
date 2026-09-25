import { describe, it, expect } from "vitest";
import { isExempt } from "@/middleware";

describe("AI endpoints exempt from session auth", () => {
  it("exempts /api/hermes/chat", () => {
    expect(isExempt("/api/hermes/chat")).toBe(true);
  });
  it("exempts /api/consuela/suggestions", () => {
    expect(isExempt("/api/consuela/suggestions")).toBe(true);
  });
  it("gates /api/consuela/briefing (F3 — session required on GET/PATCH)", () => {
    expect(isExempt("/api/consuela/briefing")).toBe(false);
  });
  it("still gates /api/emergency-contacts (lookalike sibling of /api/emergency)", () => {
    expect(isExempt("/api/emergency-contacts")).toBe(false);
  });
  it("still gates /api/consuela/telegram/mirror if it existed", () => {
    expect(isExempt("/api/consuela/telegram/mirror")).toBe(false);
  });
  it("still gates /api/db", () => {
    expect(isExempt("/api/db/members")).toBe(false);
  });
  it("/api/consuela/screensaver is exempt (guest wall display)", () => {
    expect(isExempt("/api/consuela/screensaver")).toBe(true);
  });
  it("screensaver lookalike siblings stay gated", () => {
    expect(isExempt("/api/consuela/screensaver-admin")).toBe(false);
  });
  it("MUSE surface self-authenticates (exempt from session auth)", () => {
    expect(isExempt("/api/muse/auth/login")).toBe(true);
    expect(isExempt("/api/muse/auth/logout")).toBe(true);
    expect(isExempt("/api/muse/whoami")).toBe(true);
  });
  it("MUSE lookalike siblings stay gated", () => {
    expect(isExempt("/api/musebox")).toBe(false);
  });
  it("PIN-gated task actions are exempt — the PIN is the credential (guest kitchen display)", () => {
    expect(isExempt("/api/tasks/claim")).toBe(true);
    expect(isExempt("/api/members/verify")).toBe(true);
  });
  it("the parent-PIN ledger command is exempt (it self-authenticates the PIN)", () => {
    expect(isExempt("/api/tasks/ledger")).toBe(true);
  });
  it("reward redemption is exempt — the member/parent PIN is the credential", () => {
    // Without this a guest or auto-logged-out device 401s at the middleware
    // before the PIN is ever checked, so a kid's redemption could never land.
    expect(isExempt("/api/rewards/redeem")).toBe(true);
  });
  it("reward-redemption lookalike siblings stay gated", () => {
    expect(isExempt("/api/rewards/redeem-history")).toBe(false);
    expect(isExempt("/api/rewards")).toBe(false);
  });
  it("exempts /api/tasks/approve — parent PIN is the credential", () => {
    expect(isExempt("/api/tasks/approve")).toBe(true);
    expect(isExempt("/api/tasks/approve/")).toBe(true);
  });
  it("their lookalike siblings stay gated", () => {
    expect(isExempt("/api/tasks")).toBe(false);
    expect(isExempt("/api/tasks/sync")).toBe(false);
    expect(isExempt("/api/members")).toBe(false);
    expect(isExempt("/api/members/admin")).toBe(false);
  });
});
