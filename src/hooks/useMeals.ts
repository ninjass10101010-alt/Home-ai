/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { db } from "@/db";
import { Meal } from "@/types/meals";
import { defaultMeals, mealIdeas } from "@/data/meals";

const MEALS_KEY = "consuela-meals";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

export function useMeals() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [activeDay, setActiveDay] = useState(new Date().toLocaleDateString('en-US', { weekday: 'short' }));
  
  // AI Suggestions
  const [aiMealIdeas, setAiMealIdeas] = useState<Array<{ name: string; emoji: string; tags: string[] }>>([]);
  const [aiMealLoading, setAiMealLoading] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);

  useEffect(() => {
    const pbData = db.selectMeals() as any[];
    const local = loadJSON<any[]>(MEALS_KEY, []);
    if (pbData.length > 0) {
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
      const pantry = db.selectPantry().map((p: any) => p.name).join(", ");
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

  const activeMeals = meals.filter(m => m.time === activeDay);

  return {
    meals,
    setMeals,
    activeDay,
    setActiveDay,
    activeMeals,
    deleteMeal,
    aiMealIdeas,
    aiMealLoading,
    showAiSuggestions,
    generateAiMeals,
  };
}
