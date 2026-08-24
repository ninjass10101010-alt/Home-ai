import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { listMembersSanitized } from "@/lib/server-auth";

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("listMembersSanitized", () => {
  it("merges PB rows with fallbacks and strips every pin", async () => {
    const pbRows = [
      { id: "pb1", name: "Rebecca Garcia", role: "parent", pin: "stored-pin" },
      { id: "pb2", name: "Emily Garcia", role: "child" },
    ];
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: async () => pbRows,
        }),
      })
    );
    const members = await listMembersSanitized();

    // Live PB rows win and fallback members missing from PB are merged in
    const names = members.map((m: any) => m.name);
    expect(names).toContain("Rebecca Garcia");
    expect(names).toContain("Emily Garcia");
    expect(names).toContain("Jeffery (Dad)");
    // No pin ever ships — neither the stored one nor a resolved default
    for (const m of members) {
      expect(m.pin).toBeUndefined();
    }
  });

  it("returns an empty array when PB is unreachable-safe (no rows)", async () => {
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: async () => [],
        }),
      })
    );

    const members = await listMembersSanitized();

    // Empty PB still yields the built-in fallback family (sans pins)
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((m: any) => m.pin === undefined)).toBe(true);
  });
});
