// Regression test for the /meals hydration mismatch in the PlanTab member
// strip ("Who's eating tonight"). Root cause: the module-load hydrate in
// db/index.ts warms membersCache from PocketBase ON THE SERVER (admin PB
// access), so SSR renders the real PB members (Jeffery's custom emoji 😎),
// while the client's first render still sees an empty cache (the browser
// roster fetch is async and 401s for guests) and renders the static fallback
// (Jeffery 👨) — React hydration error.
//
// This file runs in the default node environment (no jsdom) so isServer() is
// true inside db/index.ts and the hydrate takes the server path
// (pbDb.selectMembers via withAdmin) — exactly the path that warms the cache
// during SSR. The mocked PB returns the live family roster with Jeffery's
// customized 😎 emoji.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

const { pbMembers } = vi.hoisted(() => ({
  pbMembers: [
    { id: "pb1", name: "Rebecca (Mom)", role: "parent", emoji: "🐱", pin: "" },
    { id: "pb2", name: "Jeffery (Dad)", role: "parent", emoji: "😎", pin: "" },
    { id: "pb3", name: "Emily", role: "child", emoji: "👧", pin: "" },
    { id: "pb4", name: "Bailey", role: "child", emoji: "👧", pin: "" },
    { id: "pb5", name: "Jasmine", role: "child", emoji: "👧", pin: "" },
    { id: "pb6", name: "Aurora", role: "child", emoji: "👧", pin: "" },
    { id: "pb7", name: "Caspian", role: "child", emoji: "🧒", pin: "" },
    { id: "pb8", name: "Rocco", role: "pet", emoji: "🐶", pin: "" },
    { id: "pb9", name: "Rico", role: "pet", emoji: "🐩", pin: "" },
  ],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () => (name === "members" ? pbMembers : []),
        getOne: async () => null,
        create: async () => null,
        update: async () => null,
        delete: async () => true,
      }),
    }),
  getAuthedPB: async () => null,
}));

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({
    colors: { glow: "#22d3ee", gradientStop: "rgba(34,211,238,0.35)", accentColor: "#22d3ee" },
    accentRgb: "34,211,238",
  }),
}));

import { db } from "@/db";
import PlanTab from "@/components/meals/PlanTab";

async function waitForWarmedCache() {
  await vi.waitFor(
    () => {
      const members = db.selectMembers();
      expect(members.some((m: any) => m.emoji === "😎")).toBe(true);
    },
    { timeout: 3000 }
  );
}

function planTabProps() {
  const noop = () => {};
  return {
    meals: [],
    activeDay: "Wed",
    setActiveDay: noop,
    activeMeals: [],
    deleteMeal: noop,
    openRecipeModal: noop,
    showAiSuggestions: false,
    aiMealIdeas: [],
    aiMealLoading: false,
    recipes: [],
    addRecipeToMealSlot: noop,
    copyDayMeals: noop,
    duplicateMeal: noop,
    activeWeek: "2026-08-24",
    goToWeek: noop,
    archiveCurrentWeek: noop,
    isCurrentWeek: true,
    flowSummary: "3 meals planned",
    focusRecipeBox: false,
    saveCatalogRecipe: noop,
    deleteCatalogRecipe: noop,
    addRecipeToPlan: noop,
    addRecipeToGrocery: noop,
    startAddRecipe: noop,
    startEditRecipe: noop,
    handleFileUpload: noop,
    openImportModal: noop,
    openSearchModal: noop,
  };
}

describe("PlanTab member strip hydration", () => {
  it("selectMembersFallback() stays deterministic when the cache is PB-warmed", async () => {
    await waitForWarmedCache();

    // Sanity: the warmed cache reflects PB data — the server state during SSR.
    // (selectMembers() maps fullName from the cache entry's first-name field,
    // so warmed rows carry fullName === first name.)
    const warmed = db.selectMembers();
    expect(warmed.find((m: any) => m.name === "Jeffery")?.emoji).toBe("😎");

    // The pre-mount render source must ignore the warmed cache entirely.
    const fallback = (db as any).selectMembersFallback();
    expect(fallback.find((m: any) => m.fullName === "Jeffery (Dad)")?.emoji).toBe("👨");
    expect(fallback.map((m: any) => m.name)).toEqual([
      "Rebecca", "Jeffery", "Emily", "Bailey", "Jasmine", "Aurora", "Caspian", "Rocco", "Rico",
    ]);
  });

  it("server render (pre-mount) uses the deterministic fallbacks, not the PB-warmed cache", async () => {
    await waitForWarmedCache();

    const html = renderToString(<PlanTab {...planTabProps()} />);

    // The member strip renders the fallback family (client hydration state)…
    expect(html).toContain("Jeffery");
    expect(html).toContain("👨");
    // …and must NOT leak PB-only data into the SSR HTML (the hydration bug).
    expect(html).not.toContain("😎");
  });
});
