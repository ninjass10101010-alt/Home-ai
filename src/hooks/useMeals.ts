/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { db } from "@/db";
import { Meal } from "@/types/meals";
import { defaultMeals, mealIdeas } from "@/data/meals";
import { todayMondayISO, shiftWeek } from "@/lib/meals-week-utils";

const MEALS_KEY = "consuela-meals";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

export function useMeals() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [activeDay, setActiveDay] = useState(new Date().toLocaleDateString('en-US', { weekday: 'short' }));
  const [activeWeek, setActiveWeek] = useState(todayMondayISO());

  // AI Suggestions
  const [aiMealIdeas, setAiMealIdeas] = useState<Array<{ name: string; emoji: string; tags: string[] }>>([]);
  const [aiMealLoading, setAiMealLoading] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);

  useEffect(() => {
    const local = loadJSON<any[]>(MEALS_KEY, []);
    db.selectMeals().then((pbData: any) => {
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
        setMeals(local.length > 0 ? local : defaultMeals);
      }
    }).catch(() => {
      setMeals(local.length > 0 ? local : defaultMeals);
    });
  }, []);

  useEffect(() => {
    if (meals.length) localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
  }, [meals]);

  const saveMeal = async (meal: Meal) => {
    const result = await db.insertMeal(meal);
    return result;
  };

  const generateAiMeals = async () => {
    setAiMealLoading(true);
    setShowAiSuggestions(true);
    try {
      const pantry = (await db.selectPantry()).map((p: any) => p.name).join(", ");
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 4 meal ideas for a family of 7 (kids ages 5-14). Pantry has: ${pantry || "basic ingredients"}. Return as JSON: {"actions":[{"type":"meal","title":"Meal Name","detail":"Prep time · Kid-friendly tags","emoji":"🍝"}]}. Make them varied, practical, and family-friendly.`,
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];
      const ideas = actions
        .filter((a: any) => a.type === "meal")
        .map((a: any) => ({
          name: a.title,
          emoji: a.emoji || "🍽️",
          tags: a.detail?.split("·").map((t: string) => t.trim()).filter(Boolean) || ["Family"],
        }));
      setAiMealIdeas(ideas.length > 0 ? ideas : mealIdeas);
    } catch {
      setAiMealIdeas(mealIdeas);
    }
    setAiMealLoading(false);
  };

  const deleteMeal = async (id: number) => {
    await db.deleteMeal(String(id));
    setMeals(prev => prev.filter(m => m.id !== id));
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
      await db.deleteMeal(String(meal.id));
    }
    setMeals(prev => prev.filter(m => m.weekOf !== activeWeek));
    goToWeek(1);
  };

  const activeMeals = meals.filter(m => m.time === activeDay && (m.weekOf || todayMondayISO()) === activeWeek);

  const isCurrentWeek = activeWeek === todayMondayISO();

  return {
    meals,
    setMeals,
    activeDay,
    setActiveDay,
    activeWeek,
    setActiveWeek,
    activeMeals,
    deleteMeal,
    aiMealIdeas,
    aiMealLoading,
    showAiSuggestions,
    generateAiMeals,
    goToWeek,
    archiveCurrentWeek,
    isCurrentWeek,
  };
}
