import { useState, useEffect, useCallback } from "react";
import { db } from "@/db";
import { Meal } from "@/types/meals";
import { todayMondayISO, shiftWeek } from "@/lib/meals-week-utils";
import { extractActions } from "@/lib/ai-response";
import { saveOrQueue, type PendingWrite } from "@/lib/pending-writes";

const MEALS_KEY = "consuela-meals";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

export const mealCreateKey = (m: Meal) =>
  `meal:create:${m.name}|${m.time}|${m.mealType}|${m.weekOf || ""}`;

export const mealCreateWrite = (m: Meal): PendingWrite => ({
  key: mealCreateKey(m),
  collection: "meal_plan_entries",
  op: "create",
  payload: m,
  queuedAt: new Date().toISOString(),
});

export const mealUpdateWrite = (id: number | string, payload: any): PendingWrite => ({
  key: `meal:update:${id}`,
  collection: "meal_plan_entries",
  op: "update",
  id,
  payload,
  queuedAt: new Date().toISOString(),
});

export const mealDeleteWrite = (id: number | string): PendingWrite => ({
  key: `meal:delete:${id}`,
  collection: "meal_plan_entries",
  op: "delete",
  id,
  queuedAt: new Date().toISOString(),
});

export function useMeals() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [activeDay, setActiveDay] = useState(new Date().toLocaleDateString('en-US', { weekday: 'short' }));
  const [activeWeek, setActiveWeek] = useState(todayMondayISO());
  // True when the sessioned PB read was blocked (401) — the local cache may be
  // stale, so the UI can say "sign in" instead of showing it as truth.
  const [syncBlocked, setSyncBlocked] = useState(false);

  // AI Suggestions
  const [aiMealIdeas, setAiMealIdeas] = useState<Array<{ name: string; emoji: string; tags: string[] }>>([]);
  const [aiMealLoading, setAiMealLoading] = useState(false);
  const [aiMealError, setAiMealError] = useState<string | null>(null);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [weeklyPlanLoading, setWeeklyPlanLoading] = useState(false);
  const [weeklyPlanError, setWeeklyPlanError] = useState<string | null>(null);

  const pullMeals = useCallback(() => {
    const local = loadJSON<any[]>(MEALS_KEY, []);
    // gatewayReadStatus reports blocked reads instead of swallowing the 401
    // into an empty list the way db.selectMeals' fallback path does.
    (db as any).gatewayReadStatus("meal_plan_entries").then(({ items, blocked }: { items: any[]; blocked: boolean }) => {
      setSyncBlocked(blocked);
      const pbData = items;
      if (pbData && pbData.length > 0) {
        const merged = [...pbData];
        const pbNames = new Set(pbData.map((m: any) => m.name?.toLowerCase()));
        for (const item of local) {
          if (!pbNames.has(item.name?.toLowerCase())) {
            merged.push({ ...item, id: item.id || merged.length + 1 });
          }
        }
        setMeals(merged);
      } else {
        setMeals(local);
      }
    }).catch(() => {
      setMeals(local);
    });
  }, []);

  useEffect(() => {
    pullMeals();
    const onRefreshed = () => pullMeals();
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => window.removeEventListener("consuela-data-refreshed", onRefreshed);
  }, [pullMeals]);

  useEffect(() => {
    if (meals.length) localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
  }, [meals]);

  const saveMeal = async (meal: Meal): Promise<boolean> => {
    return saveOrQueue(mealCreateWrite(meal), () => db.insertMeal(meal));
  };

  const generateAiMeals = async () => {
    setAiMealLoading(true);
    setShowAiSuggestions(true);
    setAiMealError(null);
    try {
      const pantry = (await db.selectPantry()).map((p: any) => p.name || p.item).join(", ");
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 4 meal ideas for a family of 7 (kids ages 5-14). Pantry has: ${pantry || "basic ingredients"}. Return as JSON: {"actions":[{"type":"meal","title":"Meal Name","detail":"Prep time · Kid-friendly tags","emoji":"🍝"}]}. Make them varied, practical, and family-friendly.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get suggestions");
      const actions = extractActions(data.content || "");
      const ideas = actions
        .filter((a: any) => a.type === "meal")
        .map((a: any) => ({
          name: a.title || a.name,
          emoji: a.emoji || "🍽️",
          tags: a.detail?.split("·").map((t: string) => t.trim()).filter(Boolean) || ["Family"],
        }));
      setAiMealIdeas(ideas.length > 0 ? ideas : []);
      if (ideas.length === 0) setAiMealError("No ideas returned — try again");
    } catch (e: any) {
      setAiMealError(e?.message || "Failed to get suggestions");
      setAiMealIdeas([]);
    }
    setAiMealLoading(false);
  };

  const generateWeeklyPlan = useCallback(async (weekOf: string, overwrite = false, days?: string[]) => {
    setWeeklyPlanLoading(true);
    setWeeklyPlanError(null);
    try {
      const pantry = (await db.selectPantry()).map((p: any) => p.name || p.item).join(", ");
      const dayList = days?.join(", ") || "Mon, Tue, Wed, Thu, Fri, Sat, Sun";
      const coverage = days?.length
        ? `Cover breakfast, lunch, snack, and dinner for ${dayList} only (${days.length * 4} entries).`
        : "Cover breakfast, lunch, snack, and dinner for Mon, Tue, Wed, Thu, Fri, Sat, Sun.";
      const FULL_DAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
      const dayPhrase = days?.length ? `${days.map((d) => FULL_DAYS[d] || d).join(", ")} only — a day of meals` : "a complete week of meals";
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Generate ${dayPhrase} for a family of 7 (kids ages 5-14). Daily targets: 2000 kcal, 150g protein, 300g carbs, 65g fat. Pantry has: ${pantry || "basic ingredients"}. Return ONLY JSON as {"meal_plan":[ ... ${days?.length ? days.length * 4 : 28} entries ... ]} — each entry: {"day":"Mon","mealType":"breakfast","name":"Meal Name","emoji":"🍳","tags":["Kid-friendly","Quick"],"prepTime":"30 min"}. ${coverage} No prose, just the JSON.`,
          persist: false,
        }),
      });
      if (!res.ok) throw new Error("Failed to generate plan");
      const data = await res.json();

      let planItems: any[] = [];
      try {
        planItems = extractActions(data.content || "");
      } catch {
        planItems = [];
      }
      if (!planItems.length) {
        try {
          const parsed = JSON.parse(data.content || "{}");
          planItems = parsed.meal_plan || parsed.meals || parsed.actions || [];
        } catch {
          planItems = [];
        }
      }

      if (days?.length) {
        const scope = new Set(days.map((d) => d.toLowerCase()));
        planItems = planItems.filter((item: any) =>
          scope.has(String(item.day || item.time || "").toLowerCase())
        );
      }

      if (!planItems.length) {
        setWeeklyPlanError("No plan returned — try again");
        setWeeklyPlanLoading(false);
        return;
      }

      const existing = meals.filter((m) => (m.weekOf || todayMondayISO()) === weekOf);
      if (overwrite) {
        for (const m of existing) await saveOrQueue(mealDeleteWrite(m.id), () => db.deleteMeal(String(m.id)));
        setMeals((prev) => prev.filter((m) => (m.weekOf || todayMondayISO()) !== weekOf));
      }
      const occupied = new Set(existing.map((m) => `${m.time}-${m.mealType}`));

      for (const item of planItems) {
        const day = item.day || item.time;
        const mealType = item.mealType || item.meal_type;
        if (!day || !mealType) continue;
        if (!overwrite && occupied.has(`${day}-${mealType}`)) continue;
        const meal: Meal = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          name: item.name || item.title || "Meal",
          emoji: item.emoji || "🍽️",
          time: day,
          mealType,
          weekOf,
          prepTime: item.prepTime || "30 min",
          tags: item.tags || [],
          ingredients: item.ingredients || [],
          servings: 7,
          calories: Number(item.calories) || 0,
          protein: Number(item.protein) || 0,
          carbs: Number(item.carbs) || 0,
          fat: Number(item.fat) || 0,
          instructions: item.instructions || "",
          autoGenerated: true,
        };
        await saveOrQueue(mealCreateWrite(meal), () => db.insertMeal(meal));
        setMeals((prev) => [...prev, meal]);
      }
    } catch (e: any) {
      setWeeklyPlanError(e?.message || "Failed to generate plan");
    }
    setWeeklyPlanLoading(false);
  }, [meals]);

  const deleteMeal = async (id: number | string) => {
    await saveOrQueue(mealDeleteWrite(id), () => db.deleteMeal(String(id)));
    setMeals(prev => prev.filter(m => m.id !== Number(id) && String(m.id) !== String(id)));
  };

  const goToWeek = (delta: number) => {
    setActiveWeek(prev => shiftWeek(prev, delta));
    setActiveDay("Mon");
  };

  const archiveCurrentWeek = async () => {
    const weekMeals = meals.filter(m => m.weekOf === activeWeek);
    if (weekMeals.length === 0) return;
    await db.upsertMealWeekArchive({
      weekStart: activeWeek,
      archivedAt: new Date().toISOString(),
      data: weekMeals,
    });
    for (const meal of weekMeals) {
      await saveOrQueue(mealDeleteWrite(meal.id), () => db.deleteMeal(String(meal.id)));
    }
    setMeals(prev => prev.filter(m => m.weekOf !== activeWeek));
    goToWeek(1);
  };

  const activeMeals = meals.filter(m => m.time === activeDay && (m.weekOf || todayMondayISO()) === activeWeek);

  const isCurrentWeek = activeWeek === todayMondayISO();

  return {
    meals,
    setMeals,
    syncBlocked,
    activeDay,
    setActiveDay,
    activeWeek,
    setActiveWeek,
    activeMeals,
    saveMeal,
    deleteMeal,
    aiMealIdeas,
    aiMealLoading,
    aiMealError,
    showAiSuggestions,
    generateAiMeals,
    generateWeeklyPlan,
    weeklyPlanLoading,
    weeklyPlanError,
    goToWeek,
    archiveCurrentWeek,
    isCurrentWeek,
  };
}
