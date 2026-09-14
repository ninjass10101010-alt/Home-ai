import { describe, it, expect } from "vitest";
import { composeContextPrompt, type ContextPack } from "@/lib/consuela/assistant-context";

const base: ContextPack = {
  roster: [{ name: "Emily G", role: "child", age: 14 }],
  today: { iso: "2026-09-10", weekday: "Thu", yesterdayIso: "2026-09-09", weekStartISO: "2026-09-07", tz: "America/Detroit" },
  unavailable: [],
};

describe("composeContextPrompt", () => {
  it("renders roster + dates", () => {
    const s = composeContextPrompt(base);
    expect(s).toContain("Emily G");
    expect(s).toContain("Thu");
    expect(s).toContain("2026-09-07");
  });
  it("names unavailable zones as unavailable so the model says so", () => {
    const s = composeContextPrompt({ ...base, unavailable: ["pantry"] });
    expect(s).toMatch(/pantry.*unavailable/i);
    expect(s).toContain("do not guess");
  });
  it("caps calendar digest so prompts stay small", () => {
    const days: Record<string, any[]> = {};
    for (let d = 1; d <= 30; d++) days[`2026-09-${String(d).padStart(2, "0")}`] = [{ title: "X" }];
    const s = composeContextPrompt({ ...base, calendar: days });
    expect((s.match(/- /g) || []).length).toBeLessThanOrEqual(40);
  });
});
