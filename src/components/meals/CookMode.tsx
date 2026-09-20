"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Recipe } from "@/types/meals";
import { parseIngredientLine } from "@/lib/ingredient-quantity";
import { parseInstructionsToSteps } from "@/lib/recipe-steps";
import { localTodayISO } from "@/lib/local-date";

interface CookState {
  i: number[];
  s: number[];
}

const EMPTY_STATE: CookState = { i: [], s: [] };

function loadCookState(key: string): CookState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<CookState>;
    return {
      i: Array.isArray(parsed?.i) ? parsed.i : [],
      s: Array.isArray(parsed?.s) ? parsed.s : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

export default function CookMode({ recipe, onExit }: { recipe: Recipe; onExit: () => void }) {
  const storageKey = useMemo(() => `cookmode:${recipe.id}:${localTodayISO()}`, [recipe.id]);
  const [initial] = useState(() => loadCookState(storageKey));
  const [checkedIngredients, setCheckedIngredients] = useState<number[]>(initial.i);
  const [checkedSteps, setCheckedSteps] = useState<number[]>(initial.s);

  const ingredients = useMemo(
    () => (recipe.ingredients ?? []).map((i) => i.trim()).filter(Boolean),
    [recipe.ingredients]
  );
  const steps = useMemo(() => parseInstructionsToSteps(recipe.instructions || ""), [recipe.instructions]);

  const stepsDone = steps.length > 0 && checkedSteps.length >= steps.length;
  const progressPct = steps.length > 0 ? Math.round((checkedSteps.length / steps.length) * 100) : 0;

  useEffect(() => {
    if (stepsDone) {
      localStorage.removeItem(storageKey);
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ i: checkedIngredients, s: checkedSteps }));
    } catch {
      // storage full — cook progress is best-effort
    }
  }, [storageKey, checkedIngredients, checkedSteps, stepsDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const toggleIngredient = (idx: number) =>
    setCheckedIngredients((prev) => (prev.includes(idx) ? prev.filter((n) => n !== idx) : [...prev, idx]));
  const toggleStep = (idx: number) =>
    setCheckedSteps((prev) => (prev.includes(idx) ? prev.filter((n) => n !== idx) : [...prev, idx]));

  return createPortal(
    <div
      className="kitchen-text fixed inset-0 z-[300] flex flex-col bg-[var(--color-surface-0)]"
      role="dialog"
      aria-modal="true"
      aria-label={`Cook mode: ${recipe.name}`}
    >
      <div className="shrink-0 px-4 pb-2 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            aria-label="Exit cook mode"
            className="glass flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text-secondary tap-sm hover:text-text-primary"
          >
            ✕
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-text-primary">👨‍🍳 {recipe.name}</h2>
            <p className="text-[11px] font-semibold text-text-muted">
              {stepsDone
                ? "Finished!"
                : steps.length > 0
                  ? `${checkedSteps.length} of ${steps.length} steps done`
                  : "No steps to check"}
            </p>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent-selected)] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {stepsDone ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="text-6xl">🎉</span>
          <h3 className="text-xl font-extrabold text-text-primary">Enjoy!</h3>
          <p className="text-sm font-medium text-text-secondary">
            {recipe.name} is ready — great cooking, chef.
          </p>
          <button
            onClick={onExit}
            className="min-h-[44px] w-full max-w-xs rounded-2xl bg-[var(--color-accent-button)] text-sm font-bold text-white tap"
          >
            Exit
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8">
          <section aria-label="Gather ingredients">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">
              🥕 Gather · {ingredients.length > 0 ? `${checkedIngredients.length} of ${ingredients.length} ready` : "Nothing to gather"}
            </p>
            <div className="liquid-glass rounded-2xl p-2">
              {ingredients.length === 0 && (
                <p className="p-4 text-sm font-medium text-text-muted">No ingredients saved for this recipe.</p>
              )}
              {ingredients.map((ing, idx) => {
                const parsed = parseIngredientLine(ing);
                const checked = checkedIngredients.includes(idx);
                return (
                  <label
                    key={idx}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-3 ${checked ? "opacity-55" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleIngredient(idx)}
                      className="h-5 w-5 accent-[var(--color-accent-selected)]"
                    />
                    <span className={`text-sm ${checked ? "text-text-muted line-through" : "text-text-primary"}`}>
                      {parsed ? (
                        <>
                          <span className="font-bold text-[var(--color-accent-amber)]">
                            {parsed.quantity}
                            {parsed.unit ? ` ${parsed.unit}` : ""}
                          </span>{" "}
                          {parsed.rest}
                        </>
                      ) : (
                        ing
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section aria-label="Cooking steps">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">👨‍🍳 Steps</p>
            <div className="space-y-2">
              {steps.length === 0 && (
                <p className="liquid-glass rounded-2xl p-4 text-sm font-medium text-text-muted">
                  No steps saved — gather and go!
                </p>
              )}
              {steps.map((step, idx) => {
                const checked = checkedSteps.includes(idx);
                return (
                  <label
                    key={idx}
                    className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl p-3 ${checked ? "opacity-55" : "glass"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStep(idx)}
                      className="mt-0.5 h-5 w-5 accent-[var(--color-accent-selected)]"
                    />
                    <span className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-selected)]/15 text-[11px] font-extrabold text-[var(--color-accent-selected)]">
                        {idx + 1}
                      </span>
                      <span className={`text-sm leading-relaxed ${checked ? "text-text-muted line-through" : "text-text-primary"}`}>
                        {step}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>,
    document.body
  );
}
