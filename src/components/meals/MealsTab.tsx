import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { weekDays, mealIdeas } from "@/data/meals";
import { Meal } from "@/types/meals";

export default function MealsTab({
  meals,
  activeDay,
  setActiveDay,
  activeMeals, // Changed from activeMeal
  deleteMeal,
  openRecipeModal,
  setActiveTab,
  handleSyncMealToGrocery,
  isSyncing,
  showAiSuggestions,
  aiMealIdeas,
  aiMealLoading,
  importRecipeFromUrl,
  handleFileUpload
}: any) {
  
  const mealTypes = [
    { id: "breakfast", label: "Breakfast", icon: "🌅", color: "amber" },
    { id: "lunch", label: "Lunch", icon: "☀️", color: "sky" },
    { id: "dinner", label: "Dinner", icon: "🌙", color: "indigo" },
  ];

  return (
    <div className="px-4 space-y-5 pb-4">
      {/* Weekly strip */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {weekDays.map(day => {
          // Just show one icon for the day if any meal exists, or a plus
          const dayMeals = meals.filter((m: Meal) => m.time === day);
          const dinner = dayMeals.find((m: Meal) => m.mealType === "dinner") || dayMeals[0];
          const isActive = day === activeDay;
          return (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-all active:scale-95 ${
                isActive
                  ? "bg-nori-500/15 border border-nori-500/30"
                  : "glass border border-transparent hover:border-surface-4"
              }`}
            >
              <span className={`text-xs font-semibold ${isActive ? "text-nori-400" : "text-text-secondary"}`}>{day}</span>
              <span
                className="text-2xl"
                style={{ animation: isActive ? "bounce 1s ease infinite" : "none" }}
              >
                {dinner?.emoji ?? "➕"}
              </span>
              <span className="text-[10px] text-text-muted text-center leading-tight w-full truncate">
                {dinner ? `${dayMeals.length} meal${dayMeals.length > 1 ? "s" : ""}` : "Add meal"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Daily Meals Breakdown */}
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
                    <button onClick={() => openRecipeModal(mealForType)} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors">✏️</button>
                    <button onClick={() => deleteMeal(mealForType.id)} className="p-1.5 text-text-muted hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors">🗑️</button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-surface-0/50 flex items-center justify-center text-3xl shrink-0 shadow-sm border border-surface-3">
                    {mealForType.emoji || "🍽️"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-bold text-lg leading-tight truncate">
                      {mealForType.name}
                    </p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {mealForType.tags?.map((t: string) => (
                        <span key={t} className="px-2 py-0.5 rounded-md bg-surface-2 text-text-secondary text-[10px] font-medium border border-surface-3">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          } else {
            return (
              <button
                key={type.id}
                onClick={() => openRecipeModal({ mealType: type.id } as Meal)} // Passes the intended meal type
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-surface-4 text-text-muted text-sm font-medium hover:border-nori-500/40 hover:text-nori-400 hover:bg-nori-500/5 transition-all group"
              >
                <span className="text-lg opacity-50 group-hover:opacity-100 group-hover:scale-110 transition-all">{type.icon}</span>
                Plan {type.label}
              </button>
            );
          }
        })}
      </div>

      {/* Actions (if any meal exists) */}
      {activeMeals.length > 0 && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveTab("grocery")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-nori-500/15 text-nori-400 text-sm font-medium hover:bg-nori-500/25 transition-colors"
          >
            🛒 Grocery List
          </button>
          <button
            onClick={handleSyncMealToGrocery}
            disabled={isSyncing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass text-text-secondary text-sm font-medium hover:text-text-primary transition-colors disabled:opacity-60"
          >
            🔄 {isSyncing ? "Syncing..." : "Sync to Grocery"}
          </button>
        </div>
      )}

      {/* AI Suggestions */}
      {showAiSuggestions && (
        <section className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-semibold text-sm">✨ Consuela Suggests</h3>
            <Badge variant="violet">AI picks</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(aiMealIdeas.length > 0 ? aiMealIdeas : mealIdeas).map((idea: any) => (
              <Card key={idea.name} className="!p-3 cursor-pointer hover:border-nori-500/30 transition-colors"
                onClick={() => {
                  alert(`Need to add ${idea.name} to ${activeDay}`);
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

      {/* Import Recipes */}
      <section className="pb-2 pt-2">
        <h3 className="text-text-primary font-semibold text-sm mb-3">📥 Import Recipes</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "📌 Pinterest", source: "Pinterest" },
            { label: "🎵 TikTok", source: "TikTok" },
          ].map(s => (
            <button
              key={s.source}
              onClick={() => { const url = prompt(`Enter ${s.source} URL:`); if (url) importRecipeFromUrl(url, s.source); }}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium bg-nori-500/10 text-nori-400 border border-nori-500/20 hover:bg-nori-500/20 transition-all"
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => document.getElementById("recipe-file-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium glass text-text-secondary border border-surface-3 hover:text-text-primary transition-all"
          >
            📄 Upload File
          </button>
          <button
            onClick={() => document.getElementById("recipe-pdf-upload")?.click()}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-medium glass text-text-secondary border border-surface-3 hover:text-text-primary transition-all"
          >
            🗒️ Upload PDF
          </button>
        </div>
        <input type="file" id="recipe-file-upload" accept=".txt,.json,.csv" className="hidden" onChange={(e) => {if(e.target.files?.[0]) handleFileUpload(e.target.files[0])}} />
        <input type="file" id="recipe-pdf-upload" accept=".pdf" className="hidden" onChange={(e) => {if(e.target.files?.[0]) handleFileUpload(e.target.files[0])}} />
      </section>
    </div>
  );
}
