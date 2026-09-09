import { describe, it, expect } from "vitest";
import { sanitizeMember } from "@/lib/server-auth";

describe("member age data", () => {
  it("sanitizeMember keeps age and strips pin", () => {
    const out = sanitizeMember({ id: "x", name: "Caspian", role: "child", emoji: "🧒", color: "green", age: 5, pin: "1234" });
    expect(out.age).toBe(5);
    expect((out as any).pin).toBeUndefined();
  });
});
