"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Recipe } from "@/types/meals";
import { THEMEALDB_ATTRIBUTION, THEMEALDB_SITE_URL } from "@/lib/themealdb-constants";

type Phase = "idle" | "loading" | "results" | "empty" | "error" | "detail" | "saving" | "done";

const INSTRUCTIONS_EXCERPT_CHARS = 400;

export default function RecipeSearchModal({
  open,
  onClose,
  recipes,
  onSave,
  onOpenExisting,
  showToast,
}: {
  open: boolean;
  onClose: () => void;
  recipes: Recipe[];
  onSave: (recipe: Recipe) => Promise<void> | void;
  onOpenExisting?: (recipe: Recipe) => void;
  showToast: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const existingByUrl = useMemo(() => {
    if (!selected?.sourceUrl) return undefined;
    return recipes.find((r) => r.sourceUrl && r.sourceUrl === selected.sourceUrl);
  }, [recipes, selected]);

  if (!open) return null;

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const requestId = ++requestRef.current;
    setPhase("loading");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/recipes/search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json().catch(() => ({}));
      if (requestId !== requestRef.current) return;
      if (!res.ok || !Array.isArray(data?.results)) {
        setErrorMessage(typeof data?.error === "string" && data.error ? data.error : "Search failed. Try again.");
        setPhase("error");
        return;
      }
      setResults(data.results);
      setPhase(data.results.length ? "results" : "empty");
    } catch {
      if (requestId !== requestRef.current) return;
      setErrorMessage("Could not reach the recipe search. Check your connection and try again.");
      setPhase("error");
    }
  };

  const openDetail = (recipe: Recipe) => {
    setSelected(recipe);
    setPhase("detail");
  };

  const backToResults = () => {
    setSelected(null);
    setPhase(results.length ? "results" : "idle");
  };

  const handleSave = async () => {
    if (!selected) return;
    if (existingByUrl) {
      if (onOpenExisting) {
        onClose();
        onOpenExisting(existingByUrl);
      } else {
        showToast(`📖 "${existingByUrl.name}" is already in your catalog`);
        onClose();
      }
      return;
    }
    setPhase("saving");
    try {
      await onSave({ ...selected, id: Date.now(), createdAt: new Date().toISOString() });
      setPhase("done");
      closeTimerRef.current = setTimeout(() => onClose(), 900);
    } catch {
      setErrorMessage("Saving failed. Try again.");
      setPhase("error");
    }
  };

  const instructionsExcerpt = selected
    ? selected.instructions.length > INSTRUCTIONS_EXCERPT_CHARS
      ? `${selected.instructions.slice(0, INSTRUCTIONS_EXCERPT_CHARS).trimEnd()}…`
      : selected.instructions
    : "";

  const inputClass =
    "w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2.5 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted transition-colors";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl flex flex-col overflow-hidden"
        style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-surface-4)", maxHeight: "92vh" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-4" />
        </div>

        <div className="px-5 pb-4 flex items-center justify-between border-b border-surface-3">
          <div>
            <h2 className="text-text-primary font-bold text-lg">🔎 Search recipes</h2>
            <p className="text-text-muted text-xs">Find dinner ideas from TheMealDB</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-2xl glass flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors tap-sm cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="chicken, pasta, curry…"
              autoFocus
              className={inputClass}
            />
            <button
              onClick={runSearch}
              disabled={phase === "loading" || !query.trim()}
              className="shrink-0 px-4 rounded-2xl bg-[var(--color-accent-button)] text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all tap-sm cursor-pointer"
            >
              {phase === "loading" ? "…" : "Search"}
            </button>
          </div>

          {phase === "idle" && (
            <p className="text-text-muted text-xs">
              Search hundreds of free recipes — tap one to preview it, then save it to your catalog.
            </p>
          )}

          {phase === "loading" && (
            <div className="flex items-center gap-3 rounded-2xl glass border border-[var(--color-surface-3)] px-4 py-3">
              <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" />
              <p className="text-text-secondary text-sm font-medium">Searching TheMealDB…</p>
            </div>
          )}

          {phase === "error" && errorMessage && (
            <div className="rounded-2xl border border-[var(--color-accent-rose)]/30 bg-[var(--color-accent-rose)]/10 px-4 py-3">
              <p className="text-sm font-semibold text-text-primary">😕 {errorMessage}</p>
            </div>
          )}

          {phase === "empty" && (
            <div className="rounded-2xl glass border border-[var(--color-surface-3)] px-4 py-6 text-center">
              <p className="text-3xl">🍽️</p>
              <p className="mt-2 text-sm font-bold text-text-primary">No recipes found</p>
              <p className="text-xs font-medium text-text-muted mt-1">Try a simpler word like “chicken” or “cake”.</p>
            </div>
          )}

          {phase === "results" && (
            <div className="grid grid-cols-2 gap-3">
              {results.map((recipe, idx) => (
                <button
                  key={recipe.sourceUrl || `recipe-${recipe.id ?? idx}-${idx}`}
                  onClick={() => openDetail(recipe)}
                  className="text-left rounded-2xl overflow-hidden glass border border-[var(--color-surface-3)] hover:border-[var(--color-accent-selected)]/40 transition-colors tap-sm cursor-pointer"
                >
                  <div className="relative h-28 bg-surface-2 flex items-center justify-center">
                    {recipe.image ? (
                      <img src={recipe.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl">🍽️</span>
                    )}
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-sm font-bold text-text-primary leading-snug line-clamp-2">{recipe.name}</p>
                    {recipe.tags?.[0] && <p className="text-[10px] font-bold text-text-muted mt-0.5">{recipe.tags[0]}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {phase === "detail" || phase === "saving" || phase === "done" ? (
            selected && (
              <>
                {existingByUrl && (
                  <div className="rounded-2xl border border-[var(--color-accent-selected)]/30 bg-[var(--color-accent-selected)]/10 px-4 py-3">
                    <p className="text-sm font-semibold text-text-primary">
                      {`✓ Already in your catalog as "${existingByUrl.name}"`}
                    </p>
                  </div>
                )}

                <div className="relative h-44 rounded-2xl overflow-hidden bg-surface-2 flex items-center justify-center">
                  {selected.image ? (
                    <img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-6xl">🍽️</span>
                  )}
                </div>

                <div>
                  <h3 className="text-text-primary font-bold text-base">{selected.name}</h3>
                  {selected.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selected.tags.slice(0, 4).map((tag, tagIdx) => (
                        <span key={`${tag}-${tagIdx}`} className="glass-subtle rounded-full px-2 py-0.5 text-[10px] font-bold text-text-secondary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {selected.ingredients.length > 0 && (
                  <div>
                    <p className="text-text-secondary text-xs font-semibold mb-2">🧂 Ingredients</p>
                    <ul className="space-y-1">
                      {selected.ingredients.map((ing, idx) => (
                        <li key={idx} className="text-sm text-text-primary flex gap-2">
                          <span className="text-text-muted">•</span>
                          <span>{ing}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {instructionsExcerpt && (
                  <div>
                    <p className="text-text-secondary text-xs font-semibold mb-2">📋 Instructions</p>
                    <p className="text-sm text-text-secondary whitespace-pre-line leading-relaxed">{instructionsExcerpt}</p>
                  </div>
                )}

                {selected.sourceUrl && (
                  <p className="text-text-muted text-[11px] break-all">
                    Source: <span className="text-text-secondary">{selected.sourceUrl}</span>
                  </p>
                )}
              </>
            )
          ) : null}
        </div>

        {(phase === "detail" || phase === "saving" || phase === "done") && (
          <div
            className="px-5 py-4 border-t border-surface-3 flex gap-2"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <button
              onClick={backToResults}
              disabled={phase === "saving"}
              className="flex-1 py-3.5 rounded-2xl glass border border-[var(--color-surface-3)] text-text-secondary font-bold text-sm hover:text-text-primary transition-colors tap-sm cursor-pointer disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              disabled={phase === "saving" || phase === "done"}
              className="flex-[2] py-3.5 rounded-2xl bg-[var(--color-accent-button)] text-white font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all tap cursor-pointer"
            >
              {phase === "done"
                ? "✓ Saved!"
                : phase === "saving"
                  ? "Saving…"
                  : existingByUrl
                    ? "Open existing"
                    : "Save to catalog"}
            </button>
          </div>
        )}

        <div className="px-5 pb-3 pt-1 text-center" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <a
            href={THEMEALDB_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-text-muted hover:text-text-secondary transition-colors"
          >
            {THEMEALDB_ATTRIBUTION}
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
