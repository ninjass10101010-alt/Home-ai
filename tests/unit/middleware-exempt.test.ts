import { describe, it, expect } from "vitest";
import { isExempt } from "@/middleware";

describe("AI endpoints exempt from session auth", () => {
  it("exempts /api/hermes/chat", () => {
    expect(isExempt("/api/hermes/chat")).toBe(true);
  });
  it("exempts /api/consuela/suggestions", () => {
    expect(isExempt("/api/consuela/suggestions")).toBe(true);
  });
  it("exempts /api/consuela/briefing", () => {
    expect(isExempt("/api/consuela/briefing")).toBe(true);
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
});
