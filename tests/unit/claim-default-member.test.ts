// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { pickDefaultClaimMember } from "@/lib/task-utils";

const MEMBERS = [
  { fullName: "Rebecca (Mom)", name: "Rebecca (Mom)", role: "parent" },
  { fullName: "Jeffery (Dad)", name: "Jeffery (Dad)", role: "parent" },
  { fullName: "Emily", name: "Emily", role: "child" },
  { fullName: "Caspian", name: "Caspian", role: "child" },
  { fullName: "Rocco", name: "Rocco", role: "pet" },
];

describe("pickDefaultClaimMember", () => {
  it("defaults the claim to the signed-in member (kid PINs verify against the right person)", () => {
    expect(pickDefaultClaimMember(MEMBERS, "Caspian")).toBe("Caspian");
    expect(pickDefaultClaimMember(MEMBERS, "Emily")).toBe("Emily");
  });

  it("matches full-name auth identities against roster first names", () => {
    expect(pickDefaultClaimMember(MEMBERS, "Rebecca Garcia")).toBe("Rebecca (Mom)");
    expect(pickDefaultClaimMember(MEMBERS, "Jeffery")).toBe("Jeffery (Dad)");
  });

  it("falls back to the first non-pet member for guests / unknown names", () => {
    expect(pickDefaultClaimMember(MEMBERS, null)).toBe("Rebecca (Mom)");
    expect(pickDefaultClaimMember(MEMBERS, "")).toBe("Rebecca (Mom)");
    expect(pickDefaultClaimMember(MEMBERS, "Nobody")).toBe("Rebecca (Mom)");
  });

  it("never defaults a claim to a pet", () => {
    const petsOnly = [{ fullName: "Rocco", name: "Rocco", role: "pet" }];
    expect(pickDefaultClaimMember(petsOnly, "Rocco")).toBe("");
  });
});
