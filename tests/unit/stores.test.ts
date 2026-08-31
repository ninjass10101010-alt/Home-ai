import { describe, it, expect } from "vitest";
import { groupByStore } from "@/lib/stores";

describe("groupByStore", () => {
  it("groups items by store", () => {
    const items = [
      { name: "milk", store: "aldi" },
      { name: "bread", store: "meijer" },
      { name: "eggs", store: "aldi" },
    ];
    const groups = groupByStore(items);
    expect(groups["aldi"]).toHaveLength(2);
    expect(groups["meijer"]).toHaveLength(1);
  });

  it("uses 'any' for items without store", () => {
    const items: { name: string; store?: string }[] = [{ name: "milk" }];
    const groups = groupByStore(items);
    expect(groups["any"]).toHaveLength(1);
  });
});
