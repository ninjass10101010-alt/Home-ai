// @vitest-environment jsdom
// Client-side half of the /meals member-strip hydration fix: after mount, the
// strip must swap from the deterministic fallbacks to the real roster when the
// async members cache warms (db/index.ts dispatches consuela-members-updated).
// Without the PlanTab listener the memo freezes at the fallbacks forever.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

const { resolveRoster, rosterMembers } = vi.hoisted(() => {
  let resolveRoster!: (members: any[]) => void;
  const gate = new Promise<any[]>((r) => { resolveRoster = r; });
  const rosterMembers = [
    { id: "pb1", name: "Rebecca (Mom)", role: "parent", emoji: "🐱" },
    { id: "pb2", name: "Jeffery (Dad)", role: "parent", emoji: "😎" },
    { id: "pb3", name: "Emily", role: "child", emoji: "👧" },
    { id: "pb4", name: "Bailey", role: "child", emoji: "👧" },
    { id: "pb5", name: "Jasmine", role: "child", emoji: "👧" },
    { id: "pb6", name: "Aurora", role: "child", emoji: "👧" },
    { id: "pb7", name: "Caspian", role: "child", emoji: "🧒" },
    { id: "pb8", name: "Rocco", role: "pet", emoji: "🐶" },
    { id: "pb9", name: "Rico", role: "pet", emoji: "🐩" },
  ];
  // Gate the roster fetch so the test controls when the cache warms.
  (globalThis as any).fetch = (input: any) => {
    const url = String(input);
    if (url.includes("/api/members/admin")) {
      return gate.then((members) => ({ ok: true, json: async () => ({ members }) }));
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  return { resolveRoster, rosterMembers };
});

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({
    colors: { glow: "#22d3ee", gradientStop: "rgba(34,211,238,0.35)", accentColor: "#22d3ee" },
    accentRgb: "34,211,238",
  }),
}));

import { db } from "@/db";
import PlanTab from "@/components/meals/PlanTab";

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

describe("PlanTab member strip roster swap", () => {
  it("renders fallbacks before the roster lands, then swaps to the real family", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<PlanTab {...planTabProps()} />); });

    // Cache still cold → deterministic fallback family (Jeffery 👨).
    expect(el.innerHTML).toContain("Jeffery");
    expect(el.innerHTML).toContain("👨");
    expect(el.innerHTML).not.toContain("😎");

    // The roster lands → consuela-members-updated → strip recomputes.
    await act(async () => {
      resolveRoster(rosterMembers);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(el.innerHTML).toContain("😎");
    // Pets stay out of the eating strip.
    expect(el.innerHTML).not.toContain("Rocco");
  });
});
