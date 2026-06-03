"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { weekDays, mealIdeas, mealPresets } from "@/data/meals";
import { Meal } from "@/types/meals";

export default function MealsTab({
  meals,
  activeDay,
  setActiveDay,
  activeMeals,
  deleteMeal,
  openRecipeModal,
  setActiveTab,
  handleSyncMealToGrocery,
  isSyncing,
  showAiSuggestions,
  aiMealIdeas,
  aiMealLoading,
  importRecipeFromUrl,
  handleFileUpload,
}: any) {

  const mealTypes = [
    { id: "breakfast", label: "Breakfast", icon: "🌅", color: "amber" },
    { id: "lunch", label: "Lunch", icon: "☀️", color: "sky" },
    { id: "dinner", label: "Dinner", icon: "🌙", color: "indigo" },
  ];

  // Preset picker state
  const [presetPickerType, setPresetPickerType] = useState<string | null>(null);

  const presetsForType = (type: string) =>
    mealPresets.find(p => p.mealType === type)?.ideas ?? [];

  const handlePresetSelect = (idea: any, mealType: string) => {
    // Build a pre-filled meal object and open the recipe modal with it
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

  return (
    <div className="px-4 space-y-5 pb-4">
      {/* ── Weekly Strip ──────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
        {weekDays.map(day => {
          const dayMeals = meals.filter((m: Meal) => m.time === day);
          const dinner = dayMeals.find((m: Meal) => m.mealType === "dinner") || dayMeals[0];
          const isActive = day === activeDay;
          return (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-all active:scale-95 ${
                isActive
                  ? "bg-[var(--color-accent-nori)]/15 border border-[var(--color-accent-nori)]/30"
                  : "glass border border-transparent hover:border-[var(--color-surface-4)]"
              }`}
            >
              <span className={`text-xs font-semibold ${isActive ? "text-[var(--color-accent-nori)]" : "text-text-secondary"}`}>{day}</span>
              <span className="text-2xl" style={{ animation: isActive ? "bounce 1s ease infinite" : "none" }}>
                {dinner?.emoji ?? "➕"}
              </span>
              <span className="text-[10px] text-text-muted text-center leading-tight w-full truncate">
                {dinner ? `${dayMeals.length} meal${dayMeals.length > 1 ? "s" : ""}` : "Add meal"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Daily Meals Breakdown ─────────────────────── */}
      <div className="space-y-3">
        {mealTypes.map(type => {
          const mealForType = activeMeals.find((m: Meal) => m.mealType === type.id);

          if (mealForType) {
            return (
              <Card key={type.id} glow className="!p-4 border-l-4" style={{ borderLeftColor: `var(--color-accent-${type.color}, #64748b)` }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5 text-text-secondary">
                    <span>{type.icon}</span> {type.label}
                  </h3>
                  <div className="flex gap-1.5">
                    <button onClick={() => openRecipeModal(mealForType)} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-[var(--color-surface-2)] transition-colors">✏️</button>
                    <button onClick={() => deleteMeal(mealForType.id)} className="p-1.5 text-text-muted hover:text-[var(--color-accent-rose)] rounded-lg hover:bg-[var(--color-accent-rose)]/10 transition-colors">🗑️</button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-0)]/50 flex items-center justify-center text-3xl shrink-0 shadow-sm border border-[var(--color-surface-3)]">
                    {mealForType.emoji || "🍽️"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-bold text-lg leading-tight truncate">{mealForType.name}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {mealForType.tags?.map((t: string) => (
                        <span key={t} className="px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] text-text-secondary text-[10px] font-medium border border-[var(--color-surface-3)]">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          } else {
            // Empty slot — show add button OR preset picker
            const isPickerOpen = presetPickerType === type.id;
            const presets = presetsForType(type.id);

            return (
              <div key={type.id}>
                <button
                  onClick={() => setPresetPickerType(isPickerOpen ? null : type.id)}
                  className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed text-sm font-medium transition-all group ${
                    isPickerOpen
                      ? "border-[var(--color-accent-nori)]/50 text-[var(--color-accent-nori)] bg-[var(--color-accent-nori)]/5"
                      : "border-[var(--color-surface-4)] text-text-muted hover:border-[var(--color-accent-nori)]/40 hover:text-[var(--color-accent-nori)] hover:bg-[var(--color-accent-nori)]/5"
                  }`}
                >
                  <span className={`text-lg transition-all ${isPickerOpen ? "opacity-100 scale-110" : "opacity-50 group-hover:opacity-100 group-hover:scale-110"}`}>
                    {type.icon}
                  </span>
                  {isPickerOpen ? `Hide ${type.label} ideas ↑` : `Plan ${type.label}`}
                </button>

                {/* Preset picker panel */}
                {isPickerOpen && (
                  <div className="mt-2 animate-in">
                    <p className="text-[11px] text-text-muted font-semibold mb-2 px-1">
                      ⚡ Quick pick a {type.label.toLowerCase()}:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {presets.map((idea: any) => (
                        <button
                          key={idea.name}
                          onClick={() => handlePresetSelect(idea, type.id)}
                          className="flex items-center gap-3 p-3 rounded-2xl glass border border-[var(--color-surface-7)]/20
                            hover:border-[var(--color-accent-nori)]/30 hover:bg-[var(--color-accent-nori)]/5
                            transition-all active:scale-95 text-left group"
                        >
                          <span
                            className="text-2xl shrink-0 group-hover:scale-110 transition-transform"
                            style={{ animation: "float 3s ease-in-out infinite" }}
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
                      {/* Manual entry option */}
                      <button
                        onClick={() => { openRecipeModal({ mealType: type.id } as Meal); setPresetPickerType(null); }}
                        className="flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-[var(--color-surface-4)]
                          text-text-muted text-xs font-medium hover:border-[var(--color-accent-nori)]/30 hover:text-[var(--color-accent-nori)]
                          transition-all active:scale-95 col-span-2"
                      >
                        ✏️ Enter custom meal…
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }
        })}
      </div>

      {/* ── Actions ──────────────────────────────────── */}
      {activeMeals.length > 0 && (
        <div className="flex gap-2 mt-4">
          {/* Removed cross-tab nav grocery button; grocery list is shown within the Meals section. */}
          <button
            onClick={handleSyncMealToGrocery}
            disabled={isSyncing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass text-text-secondary text-sm font-medium hover:text-text-primary transition-colors disabled:opacity-60"
          >
            🔄 {isSyncing ? "Syncing..." : "Sync to Grocery"}
          </button>
        </div>
      )}

      {/* ── AI Suggestions ────────────────────────────── */}
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
                className="!p-3 cursor-pointer hover:border-[var(--color-accent-nori)]/30 transition-colors"
                onClick={() => {
                  // Default AI pick to dinner so it appears in the planner.
                  // User can change day/meal type inside the modal.
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
                  <span className="text-2xl" style={{ animation: "float 3s ease-in-out infinite" }}>{idea.emoji}</span>
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

      {/* ── Import Recipes ────────────────────────────── */}
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
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium bg-[var(--color-accent-nori)]/10 text-[var(--color-accent-nori)] border border-[var(--color-accent-nori)]/20 hover:bg-[var(--color-accent-nori)]/20 transition-all"
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => document.getElementById("recipe-file-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium glass text-text-secondary border border-[var(--color-surface-3)] hover:text-text-primary transition-all"
          >
            📄 Upload File
          </button>
          <button
            onClick={() => document.getElementById("recipe-pdf-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium glass text-text-secondary border border-[var(--color-surface-3)] hover:text-text-primary transition-all"
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
