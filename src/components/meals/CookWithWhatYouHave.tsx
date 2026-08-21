"use client";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import { findCookableRecipes } from "@/lib/recipe-pantry-match";
import type { Recipe, PantryItem } from "@/types/meals";

interface Props {
  recipes: Recipe[];
  pantryItems: PantryItem[];
  onAddMissing: (ingredients: string[]) => void;
}

export default function CookWithWhatYouHave({ recipes, pantryItems, onAddMissing }: Props) {
  const cookable = findCookableRecipes(recipes, pantryItems).slice(0, 3);

  if (cookable.length === 0) {
    return (
      <SectionCard title="Cook with what you have" icon="🍳" description="Based on your pantry">
        <p className="text-sm text-text-muted">No recipes with ingredients yet — add some in the Recipes tab.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Cook with what you have" icon="🍳" description="Ranked by pantry readiness">
      <div className="space-y-3">
        {cookable.map(({ recipe, readiness }) => (
          <div key={recipe.id} className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>{recipe.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text-primary truncate">{recipe.name}</p>
                <p className="text-[11px] font-semibold text-text-muted">
                  {readiness.readyPct}% ready · {readiness.total - readiness.missing.length}/{readiness.total} ingredients
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                readiness.readyPct === 100
                  ? "bg-[var(--color-accent-mint)]/15 text-[var(--color-accent-mint)]"
                  : "bg-[var(--color-accent-amber)]/15 text-[var(--color-accent-amber)]"
              }`}>
                {readiness.readyPct === 100 ? "Cook now" : "Almost"}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent-mint)] transition-all duration-500"
                style={{ width: `${readiness.readyPct}%` }}
              />
            </div>
            {readiness.missing.length > 0 && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                  Missing: {readiness.missing.join(", ")}
                </p>
                <SoftButton variant="ghost" size="sm" onClick={() => onAddMissing(readiness.missing)}>
                  Add missing
                </SoftButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
