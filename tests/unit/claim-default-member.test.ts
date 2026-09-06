// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { pickDefaultClaimMember, resolveMemberName } from "@/lib/task-utils";

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

describe("resolveMemberName", () => {
  // The ledger key must be the roster-resolved FULL name: auth sessions can
  // carry a short/first name while weekData.points is keyed by fullName.
  const LEDGER = [
    { fullName: "Jasmine Rose", name: "Jasmine", role: "child" },
    { fullName: "Rebecca (Mom)", name: "Rebecca", role: "parent" },
    { fullName: "Rocco", name: "Rocco", role: "pet" },
  ];

  it("resolves an exact roster name to its fullName ledger key", () => {
    expect(resolveMemberName(LEDGER, "Jasmine")).toBe("Jasmine Rose");
    expect(resolveMemberName(LEDGER, "Rebecca")).toBe("Rebecca (Mom)");
  });

  it("resolves an exact fullName (or full-name auth identity) to itself", () => {
    expect(resolveMemberName(LEDGER, "Jasmine Rose")).toBe("Jasmine Rose");
    expect(resolveMemberName(LEDGER, "Rebecca Garcia")).toBe("Rebecca (Mom)");
  });

  it("never resolves to a pet", () => {
    expect(resolveMemberName(LEDGER, "Rocco")).toBe("Rocco");
  });

  it("passes through unknown names untouched (no invented members)", () => {
    expect(resolveMemberName(LEDGER, "Mystery Kid")).toBe("Mystery Kid");
    expect(resolveMemberName(LEDGER, null)).toBe("");
    expect(resolveMemberName(LEDGER, "")).toBe("");
  });

  it("handles an empty roster by returning the raw name", () => {
    expect(resolveMemberName([], "Jasmine")).toBe("Jasmine");
  });
});
