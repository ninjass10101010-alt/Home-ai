/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";
import { useState, useMemo, useEffect } from "react";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import { weekDays, mealIdeas, mealPresets, slotMeta, smartTips, CALORIE_GOAL, PROTEIN_GOAL, CARBS_GOAL, FAT_GOAL } from "@/data/meals";
import { Meal } from "@/types/meals";
import { db } from "@/db";

const mealTypes = [
  { id: "breakfast", label: "Breakfast", icon: "🌅" },
  { id: "lunch", label: "Lunch", icon: "☀️" },
  { id: "snack", label: "Snack", icon: "🥨" },
  { id: "dinner", label: "Dinner", icon: "🌙" },
];

const dayFullNames: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

function slotColorVar(id: string): string {
  const map: Record<string, string> = {
    breakfast: "var(--color-accent-amber, #fbbf24)",
    lunch: "var(--color-accent-mint, #34d399)",
    snack: "var(--color-accent-cyan, #22d3ee)",
    dinner: "var(--color-accent-rose, #f43f5e)",
  };
  return map[id] || "var(--color-accent-selected)";
}

function timeOfDayMeal(meals: Meal[]): Meal | undefined {
  const now = new Date();
  const h = now.getHours();
  if (h < 10) return meals.find(m => m.mealType === "breakfast") || meals.find(m => m.mealType === "lunch");
  if (h < 14) return meals.find(m => m.mealType === "lunch") || meals.find(m => m.mealType === "dinner");
  if (h < 17) return meals.find(m => m.mealType === "snack") || meals.find(m => m.mealType === "dinner");
  return meals.find(m => m.mealType === "dinner") || meals[0];
}

function ingredientReadiness(meal: Meal): { ready: number; total: number } {
  if (!meal.ingredients?.length) return { ready: 0, total: 0 };
  const pantryItems = db.selectPantry();
  const total = meal.ingredients.filter(i => i.trim()).length;
  let ready = 0;
  meal.ingredients.forEach(ing => {
    if (!ing.trim()) return;
    const found = pantryItems.some((p: any) =>
      p.item?.toLowerCase().includes(ing.toLowerCase().split(" ")[0]) ||
      p.name?.toLowerCase().includes(ing.toLowerCase().split(" ")[0])
    );
    if (found) ready++;
  });
  return { ready, total };
}

export default function MealsTab({
  meals, activeDay, setActiveDay, activeMeals, deleteMeal,
  openRecipeModal, setActiveTab, handleSyncMealToGrocery, isSyncing,
  showAiSuggestions, aiMealIdeas, aiMealLoading, recipes,
  addRecipeToMealSlot, importRecipeFromUrl, handleFileUpload,
}: any) {

  const { colors, accentRgb } = useAtmosphericTheme();
  const [presetPickerType, setPresetPickerType] = useState<string | null>(null);
  const [mealFilter, setMealFilter] = useState<string | null>(null);
  const [showRecipeCatalog, setShowRecipeCatalog] = useState(false);
  const [recipeAddDay, setRecipeAddDay] = useState(activeDay);
  const [eatingMembers, setEatingMembers] = useState<string[]>([]);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [initializedEaters, setInitializedEaters] = useState(false);

  // Defer reading db.selectMembersDetailed() until after mount.
  // db/index.ts hydrates membersStore from localStorage at module load, so
  // on the server `typeof window === "undefined"` returns the default emoji
  // list (🐱, 🧒, etc.), but on the client it returns the user's custom
  // avatars (often base64 data URLs). Reading on the first render causes a
  // hydration mismatch (server: 🐱 / client: data:image/webp;...). The other
  // pages in the app already use this `mounted` pattern (see tasks/page.tsx,
  // page.tsx, etc.) — we apply it here too.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const presetsForType = (type: string) =>
    mealPresets.find(p => p.mealType === type)?.ideas ?? [];

  const handlePresetSelect = (idea: any, mealType: string) => {
    openRecipeModal({
      mealType,
      name: idea.name,
      emoji: idea.emoji,
      tags: idea.tags,
      prepTime: idea.prepTime,
      ingredients: idea.ingredients,
    } as Partial<Meal>);
    setPresetPickerType(null);
  };

  const totalKcal = activeMeals.reduce((sum: number, m: Meal) => sum + (m.calories || 0), 0);
  const totalProtein = activeMeals.reduce((sum: number, m: Meal) => sum + (m.protein || 0), 0);
  const totalCarbs = activeMeals.reduce((sum: number, m: Meal) => sum + (m.carbs || 0), 0);
  const totalFat = activeMeals.reduce((sum: number, m: Meal) => sum + (m.fat || 0), 0);
  const kcalPct = Math.min(100, Math.round((totalKcal / CALORIE_GOAL) * 100));
  const proteinPct = Math.min(100, Math.round((totalProtein / PROTEIN_GOAL) * 100));
  const carbsPct = Math.min(100, Math.round((totalCarbs / CARBS_GOAL) * 100));
  const fatPct = Math.min(100, Math.round((totalFat / FAT_GOAL) * 100));

  const familyMembers = useMemo(() => {
    if (!mounted) return db.selectMembers().slice(0, 6);
    return (db as any).selectMembersDetailed?.()?.filter?.((m: any) => m.role !== "Pet" && m.role !== "pet") ??
      db.selectMembers().slice(0, 6);
  }, [mounted]);

  useEffect(() => {
    if (mounted && familyMembers.length && !initializedEaters) {
      setEatingMembers(familyMembers.map((m: any) => m.name));
      setInitializedEaters(true);
    }
  }, [mounted, familyMembers, initializedEaters]);

  const tip = useMemo(() => {
    // `Date.now()` is impure and can drift between server and client first
    // render. Pick a deterministic index on the first render and re-pick
    // after mount so hydration matches.
    if (!mounted) return smartTips[0];
    return smartTips[Math.floor(Date.now() / 86400000) % smartTips.length];
  }, [mounted]);

  const tonightDinner = useMemo(() => {
    const d = activeMeals.find((m: Meal) => m.mealType === "dinner") || activeMeals[0];
    if (!d) return null;
    const readiness = ingredientReadiness(d);
    return { meal: d, readiness };
  }, [activeMeals]);

  const visibleMealTypes = useMemo(() => {
    if (!mealFilter) return mealTypes;
    return mealTypes.filter(t => t.id === mealFilter);
  }, [mealFilter]);

  const nextEmptySlotType = useMemo(() => {
    if (!recipes?.length) return null;
    const occupied = new Set(activeMeals.map((m: Meal) => m.mealType));
    const order = ["dinner", "lunch", "breakfast", "snack"];
    for (const id of order) {
      if (!occupied.has(id)) return mealTypes.find(t => t.id === id) || mealTypes[3];
    }
    return mealTypes[3];
  }, [activeMeals, recipes]);

  const ringCircumference = 2 * Math.PI * 42;
  const ringStroke = (pct: number) => `${(pct / 100) * ringCircumference} ${ringCircumference}`;

  return (
    <div className="space-y-6 pb-6">
      {/* ── Meal-type filter pills ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => setMealFilter(null)}
          className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
            !mealFilter
              ? "bg-[var(--color-accent-selected)] text-white shadow-lg shadow-[var(--color-accent-selected)]/25"
              : "glass-subtle text-text-secondary hover:text-text-primary"
          }`}
        >
          All
        </button>
        {mealTypes.map(type => {
          const hasMeal = activeMeals.some((m: Meal) => m.mealType === type.id);
          return (
            <button
              key={type.id}
              onClick={() => setMealFilter(mealFilter === type.id ? null : type.id)}
              className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 ${
                mealFilter === type.id
                  ? "text-white shadow-lg"
                  : "glass-subtle text-text-secondary hover:text-text-primary"
              }`}
              style={mealFilter === type.id ? {
                backgroundColor: slotColorVar(type.id),
                boxShadow: `0 8px 24px ${slotColorVar(type.id)}40`,
              } : undefined}
            >
              <span className="text-sm">{type.icon}</span>
              <span>{type.label}</span>
              {hasMeal && (
                <span className={`h-1.5 w-1.5 rounded-full ${mealFilter === type.id ? "bg-white/80" : ""}`} style={mealFilter !== type.id ? { backgroundColor: slotColorVar(type.id) } : undefined} />
              )}
            </button>
          );
        })}
      </div>

      {recipes?.length > 0 && (
        <div className="glass rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowRecipeCatalog(v => !v)}
              className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              <span className="text-lg">{showRecipeCatalog ? "📖" : "📘"}</span>
              <span className="text-sm font-semibold">Recipe catalog</span>
              <span className="glass-subtle rounded-full px-2 py-0.5 text-[11px] font-bold text-text-muted">
                {recipes.length} recipe{recipes.length > 1 ? "s" : ""}
              </span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${showRecipeCatalog ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showRecipeCatalog && nextEmptySlotType && (
              <button
                onClick={() => setActiveTab("recipes")}
                className="rounded-full px-3 py-1 text-[11px] font-bold glass-subtle text-text-secondary hover:text-text-primary transition-colors"
              >
                Browse all →
              </button>
            )}
          </div>

          {showRecipeCatalog && (
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
              {recipes.slice(0, 10).map((recipe: any) => (
                <div
                  key={recipe.id}
                  className="shrink-0 w-[200px] liquid-glass rounded-2xl p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl shrink-0">
                      {recipe.emoji || "📖"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-text-primary leading-tight truncate">
                        {recipe.name}
                      </p>
                      <p className="text-[10px] font-semibold text-text-muted mt-0.5">
                        {recipe.prepTime || "—"}
                        {recipe.servings ? ` · ${recipe.servings} servings` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="relative flex-1 group">
                    <button
                      onClick={() => {
                        if (nextEmptySlotType) {
                          addRecipeToMealSlot(recipe, activeDay, nextEmptySlotType.id);
                        }
                      }}
                      className="w-full cursor-pointer rounded-xl bg-[var(--color-accent-button)] py-2 text-xs font-bold text-white shadow-lg shadow-[var(--color-accent-selected)]/25 hover:opacity-90"
                    >
                      ＋ Add to {activeDay} {nextEmptySlotType?.label ?? "dinner"}
                    </button>
                    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:grid grid-cols-7 gap-0.5 bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] rounded-2xl shadow-xl p-1 z-50">
                      {weekDays.map(day => (
                        <button
                          key={day}
                          onClick={(e) => {
                            e.stopPropagation();
                            addRecipeToMealSlot(recipe, day, nextEmptySlotType?.id ?? "dinner");
                          }}
                          className="rounded-lg px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-[var(--color-accent-selected)]/15 hover:text-[var(--color-accent-selected)] whitespace-nowrap"
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Left Column ────────────────────────────────── */}
        <div key={activeDay} className="space-y-5 min-w-0">
          {/* ── Weekly Strip ── */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
            {weekDays.map(day => {
              const dayMeals = meals.filter((m: Meal) => m.time === day);
              const dinner = dayMeals.find((m: Meal) => m.mealType === "dinner") || dayMeals[0];
              const isActive = day === activeDay;
              const mealCount = dayMeals.length;
              return (
                <button
                  key={day}
                  onClick={() => setActiveDay(day)}
                  className={`shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-colors ${
                    isActive
                      ? "bg-[var(--color-accent-selected)]/15 border border-[var(--color-accent-selected)]/30"
                      : "glass border border-transparent hover:border-[var(--color-surface-4)]"
                  }`}
                >
                  <span className={`text-xs font-semibold ${isActive ? "text-[var(--color-accent-selected)]" : "text-text-secondary"}`}>{day}</span>
                  <span className="text-2xl">
                    {dinner?.emoji ?? "➕"}
                  </span>
                  <span className="text-[10px] text-text-muted text-center leading-tight w-full truncate">
                    {mealCount > 0 ? `${mealCount} meal${mealCount > 1 ? "s" : ""}` : "Empty"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Empty Day State ── */}
          {activeMeals.length === 0 && (
            <div className="text-center py-8 glass rounded-2xl">
              <div className="text-4xl mb-3">🍽️</div>
              <h3 className="text-text-primary font-bold text-base">Start planning {dayFullNames[activeDay] || activeDay}</h3>
              <p className="text-text-muted text-xs font-medium mt-1 max-w-xs mx-auto">
                Tap any meal slot below to add breakfast, lunch, a snack, or dinner.
              </p>
            </div>
          )}

          {/* ── Daily Meals Timeline ── */}
          <div className="space-y-3">
            {visibleMealTypes.map(type => {
              const meta = slotMeta[type.id];
              const mealForType = activeMeals.find((m: Meal) => m.mealType === type.id);

              if (mealForType) {
                return (
                  <div
                    key={type.id}
                    className="liquid-glass group rounded-2xl overflow-hidden"
                    style={{ borderLeft: `4px solid ${slotColorVar(type.id)}` }}
                  >
                    <div className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 shrink-0 rounded-2xl bg-[var(--color-surface-0)]/50 flex items-center justify-center text-3xl shadow-sm border border-[var(--color-surface-3)]">
                          {mealForType.emoji || "🍽️"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: meta?.color || "var(--color-accent-selected)" }}
                            />
                            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                              {meta?.label || type.label} · {meta?.time || ""}
                            </span>
                            <div className="ml-auto flex gap-1.5">
                              <button onClick={() => openRecipeModal(mealForType)} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-[var(--color-surface-2)] transition-colors">✏️</button>
                              <button onClick={() => deleteMeal(mealForType.id)} className="p-1.5 text-text-muted hover:text-[var(--color-accent-rose)] rounded-lg hover:bg-[var(--color-accent-rose)]/10 transition-colors">🗑️</button>
                            </div>
                          </div>
                          <h3 className="truncate text-base font-bold text-text-primary leading-tight mt-0.5">
                            {mealForType.name}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-text-muted">
                            {mealForType.calories > 0 && (
                              <span className="glass-subtle rounded-full px-2 py-0.5">🔥 {mealForType.calories} kcal</span>
                            )}
                            {mealForType.prepTime && (
                              <span className="glass-subtle rounded-full px-2 py-0.5">⏱ {mealForType.prepTime}</span>
                            )}
                            {mealForType.servings > 0 && (
                              <span className="glass-subtle rounded-full px-2 py-0.5">👨‍👩‍👧‍👦 {mealForType.servings}</span>
                            )}
                            {mealForType.tags?.map((t: string) => (
                              <span key={t} className="hidden sm:inline rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-text-secondary text-[10px] font-medium border border-[var(--color-surface-3)]">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-0)]/70 text-text-secondary shadow transition group-hover:flex hover:bg-[var(--color-accent-selected)] hover:text-white">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Empty slot
              const isPickerOpen = presetPickerType === type.id;
              const presets = presetsForType(type.id);

              return (
                <div key={type.id}>
                  <button
                    onClick={() => setPresetPickerType(isPickerOpen ? null : type.id)}
                    className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed text-sm font-medium transition-all group overflow-hidden ${
                      isPickerOpen
                        ? "text-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/5"
                        : "border-[var(--color-surface-4)] text-text-muted hover:border-[var(--color-accent-selected)]/40 hover:text-[var(--color-accent-selected)] hover:bg-[var(--color-accent-selected)]/5"
                    }`}
                    style={isPickerOpen ? { borderLeftColor: slotColorVar(type.id), borderLeftWidth: "4px" } : undefined}
                  >
                    <span className={`text-lg transition-colors ${isPickerOpen ? "opacity-100" : "opacity-50 group-hover:opacity-100"}`}>
                      {type.icon}
                    </span>
                    {isPickerOpen ? `Hide ${type.label} ideas ↑` : `Plan ${type.label}`}
                  </button>

                  {isPickerOpen && (
                    <div className="mt-2 space-y-3">
                      <div>
                        <p className="text-[11px] text-text-muted font-semibold mb-2 px-1">
                          ⚡ Quick pick a {type.label.toLowerCase()}:
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {presets.map((idea: any) => (
                            <button
                              key={idea.name}
                              onClick={() => handlePresetSelect(idea, type.id)}
                              className="flex items-center gap-3 p-3 rounded-2xl glass border border-[var(--color-surface-7)]/20
                                hover:border-[var(--color-accent-selected)]/30 hover:bg-[var(--color-accent-selected)]/5
                                transition-colors active:opacity-70 text-left group"
                              >
                                <span
                                  className="text-2xl shrink-0"
                                >
                                {idea.emoji}
                              </span>
                              <div className="min-w-0">
                                <p className="text-text-primary text-xs font-semibold leading-tight truncate">{idea.name}</p>
                                <p className="text-text-muted text-[10px] mt-0.5">{idea.prepTime}</p>
                                <div className="flex gap-1 flex-wrap mt-1">
                                  {idea.tags.slice(0, 2).map((t: string) => (
                                    <span key={t} className="px-1.5 py-0.5 rounded-md bg-[var(--color-surface-2)] text-text-secondary text-[9px] font-medium">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </button>
                          ))}
                          <button
                            onClick={() => { openRecipeModal({ mealType: type.id } as Meal); setPresetPickerType(null); }}
                            className="flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-[var(--color-surface-4)]
                              text-text-muted text-xs font-medium hover:border-[var(--color-accent-selected)]/30 hover:text-[var(--color-accent-selected)]
                              transition-colors active:opacity-70 col-span-2"
                          >
                            ✏️ Enter custom meal…
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[var(--color-surface-4)]/60">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] text-text-muted font-semibold px-1">
                            📖 Recipe catalog → add to {activeDay} ({type.label}):
                          </p>
                          <span className="text-[10px] text-text-muted px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-surface-3)]">
                            {recipes?.length ? `${recipes.length} recipes` : "No recipes"}
                          </span>
                        </div>
                        {recipes?.length ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {recipes.map((r: any) => (
                              <button
                                key={r.id}
                                onClick={() => { addRecipeToMealSlot(r, activeDay, type.id); setPresetPickerType(null); }}
                                className="flex items-start gap-3 p-3 rounded-2xl glass border border-[var(--color-surface-7)]/20
                                  hover:border-[var(--color-accent-selected)]/30 hover:bg-[var(--color-accent-selected)]/5
                                transition-colors active:opacity-70 text-left group"
                              >
                                <span className="text-2xl shrink-0">
                                  {r.emoji}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-text-primary text-xs font-semibold leading-tight truncate">{r.name}</p>
                                  <p className="text-text-muted text-[10px] mt-0.5">{r.prepTime} · {r.servings} servings</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-4">
                            <p className="text-text-muted text-xs">No recipes in your catalog yet.</p>
                            <p className="text-text-muted text-[10px] mt-1">Go to 📖 Recipes tab to add/import.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add meal button */}
            <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-[var(--color-surface-4)] text-sm font-bold text-text-muted/70 transition hover:bg-[var(--color-accent-selected)]/5 hover:border-[var(--color-accent-selected)]/40 hover:text-[var(--color-accent-selected)]">
              <span className="text-lg leading-none">＋</span> Add a meal to {dayFullNames[activeDay] || activeDay}
            </button>
          </div>

          {/* ── Actions ── */}
          {activeMeals.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={handleSyncMealToGrocery}
                disabled={isSyncing}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl glass text-text-secondary text-sm font-medium hover:text-text-primary transition-colors disabled:opacity-60"
              >
                🔄 {isSyncing ? "Syncing..." : "Sync to Grocery"}
              </button>
            </div>
          )}
        </div>

        {/* ── Right Column: Widgets ────────────────────── */}
        <div className="space-y-5 min-w-0">
          {/* ── Tonight's Dinner hero ── */}
          {tonightDinner && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Tonight&apos;s dinner
                </p>
                <span className="text-lg">
                  {tonightDinner.meal.emoji || "🍽️"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-text-primary leading-tight truncate">{tonightDinner.meal.name}</h3>
                  <p className="text-[11px] font-semibold text-text-muted mt-1">
                    ⏱ {tonightDinner.meal.prepTime || "—"}
                    {tonightDinner.meal.calories ? ` · 🔥 ${tonightDinner.meal.calories} kcal` : ""}
                    {tonightDinner.meal.servings ? ` · 👨‍👩‍👧‍👦 ${tonightDinner.meal.servings}` : ""}
                  </p>
                </div>
              </div>
              {tonightDinner.readiness.total > 0 && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${tonightDinner.readiness.total > 0 ? Math.round((tonightDinner.readiness.ready / tonightDinner.readiness.total) * 100) : 0}%`,
                        background: `linear-gradient(90deg, ${slotColorVar("dinner")}, var(--color-accent-amber))`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-text-muted">
                    {tonightDinner.readiness.ready} of {tonightDinner.readiness.total} ingredients ready in your pantry
                  </p>
                </>
              )}
              {tonightDinner.meal.tags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tonightDinner.meal.tags.slice(0, 3).map((t: string) => (
                    <span key={t} className="glass-subtle rounded-full px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Nutrition Ring */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Family fuel today
            </h3>
            <div className="mt-4 flex items-center gap-5">
              <div className="relative h-28 w-28 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-surface-3)" strokeWidth="11" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke={`var(--color-accent-selected)`} strokeWidth="11" strokeLinecap="round"
                    strokeDasharray={ringStroke(kcalPct)}
                    style={{ opacity: 0.85 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-black text-text-primary">{totalKcal}</span>
                  <span className="text-[10px] font-bold text-text-muted">/ {CALORIE_GOAL} kcal</span>
                </div>
              </div>
              <div className="flex-1 space-y-2.5 text-xs font-bold">
                {[
                  { label: "Protein", val: proteinPct, gram: totalProtein, unit: "g", color: "bg-[var(--color-accent-mint)]" },
                  { label: "Carbs", val: carbsPct, gram: totalCarbs, unit: "g", color: "bg-[var(--color-accent-amber)]" },
                  { label: "Fats", val: fatPct, gram: totalFat, unit: "g", color: "bg-[var(--color-accent-rose)]" },
                ].map(m => (
                  <div key={m.label}>
                    <div className="mb-1 flex justify-between text-text-secondary">
                      <span>{m.label}</span>
                      <span>{m.gram}{m.unit} · {m.val}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div className={`${m.color} h-full rounded-full transition-all duration-500`} style={{ width: `${m.val}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Who's Eating */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Who&apos;s eating tonight
              </h3>
              <span className="text-[10px] font-semibold text-text-muted">{eatingMembers.length} / {familyMembers.length}</span>
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {familyMembers.map((member: any) => {
                const isEating = eatingMembers.includes(member.name);
                return (
                  <button
                    key={member.name}
                    type="button"
                    onClick={() => {
                      setEatingMembers(prev =>
                        prev.includes(member.name)
                          ? prev.filter(n => n !== member.name)
                          : [...prev, member.name]
                      );
                    }}
                    className={`flex flex-col items-center gap-1 transition-all active:scale-90 ${
                      isEating ? "opacity-100" : "opacity-35 grayscale"
                    }`}
                    aria-label={isEating ? `Remove ${member.name}` : `Add ${member.name}`}
                    title={isEating ? `Remove ${member.name}` : `Add ${member.name}`}
                  >
                    <Avatar
                      name={member.name}
                      color={member.color || "green"}
                      emoji={member.emoji}
                      size="md"
                      variant="emoji"
                    />
                    <span className="text-[11px] font-bold text-text-secondary">{member.name}</span>
                  </button>
                );
              })}
              {eatingMembers.length < familyMembers.length && (
                <button
                  type="button"
                  onClick={() => setShowMemberPicker(v => !v)}
                  className="ml-1 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-[var(--color-surface-4)] text-xl font-bold text-text-muted/70 transition hover:bg-[var(--color-surface-0)]/60 hover:border-[var(--color-accent-selected)]/40"
                  aria-label="Add members"
                  title="Add members"
                >
                  ＋
                </button>
              )}
            </div>
            {showMemberPicker && (
              <div className="mt-3 pt-3 border-t border-[var(--color-surface-4)]/60">
                <p className="text-[10px] font-semibold text-text-muted mb-2">Not eating tonight — tap to add back:</p>
                <div className="flex gap-2 flex-wrap">
                  {familyMembers.filter((m: any) => !eatingMembers.includes(m.name)).map((member: any) => (
                    <button
                      key={member.name}
                      type="button"
                      onClick={() => {
                        setEatingMembers(prev => [...prev, member.name]);
                        setShowMemberPicker(false);
                      }}
                      className="flex items-center gap-2 rounded-full border border-dashed border-[var(--color-surface-4)] px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary hover:border-[var(--color-accent-selected)]/40 transition-all active:scale-90"
                    >
                      <span>{member.emoji}</span>
                      <span>＋ {member.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Smart Tip */}
          <div className="glass-subtle rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-2xl shadow"
                style={{ backgroundColor: `var(--color-accent-amber, #fbbf24)20` }}
              >
                {tip.emoji}
              </div>
              <div>
                <h4 className="font-bold text-text-primary">{tip.title}</h4>
                <p className="mt-1 text-xs font-medium leading-relaxed text-text-secondary">
                  {tip.text}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── AI Suggestions ── */}
      {showAiSuggestions && (
        <section className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-semibold text-sm">✨ Consuela Suggests</h3>
            <Badge variant="violet">AI picks</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(aiMealIdeas.length > 0 ? aiMealIdeas : mealIdeas).map((idea: any) => (
              <Card
                key={idea.name}
                className="!p-3 cursor-pointer hover:border-[var(--color-accent-selected)]/30 transition-colors"
                onClick={() => {
                  openRecipeModal({
                    time: activeDay,
                    mealType: "dinner",
                    name: idea.name,
                    emoji: idea.emoji,
                    tags: idea.tags,
                    prepTime: "30 min",
                    ingredients: [""],
                  } as Partial<Meal>);
                }}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="text-2xl">{idea.emoji}</span>
                  <p className="text-text-primary text-xs font-medium leading-tight">{idea.name}</p>
                  <div className="flex gap-1 flex-wrap justify-center">
                    {idea.tags.map((t: string) => <Badge key={t} variant="gray">{t}</Badge>)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {aiMealLoading && (
            <p className="text-text-muted text-xs text-center mt-2">Asking Consuela for ideas...</p>
          )}
        </section>
      )}

      {/* ── Import Recipes ── */}
      <section className="pb-2 pt-2">
        <h3 className="text-text-primary font-semibold text-sm mb-3">📥 Import Recipes</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "🌐 Web Import", source: "Web" },
          ].map(s => (
            <button
              key={s.source}
              onClick={() => {
                const url = prompt(`Enter recipe URL (Pinterest/TikTok/etc):`);
                if (url) importRecipeFromUrl(url, s.source);
              }}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-xs font-medium bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)] border border-[var(--color-accent-selected)]/20 hover:bg-[var(--color-accent-selected)]/20 transition-all"
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => document.getElementById("recipe-file-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-xs font-medium glass text-text-secondary border border-[var(--color-surface-3)] hover:text-text-primary transition-all"
          >
            📄 Upload File
          </button>
          <button
            onClick={() => document.getElementById("recipe-pdf-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-xs font-medium glass text-text-secondary border border-[var(--color-surface-3)] hover:text-text-primary transition-all"
          >
            🗒️ Upload PDF
          </button>
        </div>
        <input type="file" id="recipe-file-upload" accept=".txt,.json,.csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
        <input type="file" id="recipe-pdf-upload" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
      </section>
    </div>
  );
}