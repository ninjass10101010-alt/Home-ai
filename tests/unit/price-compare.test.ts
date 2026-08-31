import { describe, it, expect } from "vitest";
import {
  calculateCheapestSplit,
  formatStoreTotal,
  PriceCompareItem,
} from "@/lib/stores";

describe("price comparison", () => {
  it("finds the cheapest store for a single item", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 2.99, meijer: 3.49, costco: 2.79 } },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.totalByStore).toBeDefined();
    expect(split.cheapestStore).toBe("costco");
  });

  it("handles items with no price data", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 2.99 } },
      { name: "eggs", prices: {} },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.totalByStore.aldi).toBe(2.99);
    expect(split.totalByStore.meijer).toBeUndefined();
  });

  it("sums prices across multiple items per store", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 2.99, meijer: 3.49 } },
      { name: "eggs", prices: { aldi: 1.99, meijer: 2.29 } },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.totalByStore.aldi).toBeCloseTo(4.98);
    expect(split.totalByStore.meijer).toBeCloseTo(5.78);
    expect(split.cheapestStore).toBe("aldi");
  });

  it("calculates savings vs second cheapest", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 3.00, meijer: 5.00 } },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.savings).toBeCloseTo(2.00);
  });

  it("returns null cheapest when no prices exist", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: {} },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.cheapestStore).toBeNull();
    expect(split.savings).toBe(0);
  });

  it("formats store totals", () => {
    expect(formatStoreTotal(42.3)).toBe("$42.30");
    expect(formatStoreTotal(0)).toBe("$0.00");
    expect(formatStoreTotal(9.5)).toBe("$9.50");
  });
});
