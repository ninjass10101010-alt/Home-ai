import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "@/lib/pb-seed";

describe("push_subscriptions collection seed", () => {
  const c = COLLECTIONS.find((row) => row.name === "push_subscriptions");
  it("exists", () => expect(c).toBeTruthy());
  it("has the subscription fields", () => {
    const names = (c?.schema ?? []).map((f) => f.name).sort();
    expect(names).toEqual(["auth", "deviceLabel", "endpoint", "memberName", "p256dh"]);
  });
  it("has a unique endpoint index", () => {
    expect((c?.indexes ?? []).some((i) => /unique/i.test(i) && /endpoint/i.test(i))).toBe(true);
  });
});