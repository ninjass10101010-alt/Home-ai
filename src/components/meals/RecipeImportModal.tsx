"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RECIPE_TAGS, foodEmojis } from "@/data/meals";
import { Recipe } from "@/types/meals";

type ImportTab = "url" | "text";
type Phase = "idle" | "fetching" | "preview" | "saving" | "done" | "error";

interface DraftRecipe {
  name: string;
  emoji: string;
  image: string;
  prepTime: string;
  cookTime: string;
  servings: number;
  calories: number;
  ingredients: string[];
  instructions: string;
  tags: string[];
  sourceUrl?: string;
  needsReview?: boolean;
}

const EMPTY_DRAFT: DraftRecipe = {
  name: "",
  emoji: "📖",
  image: "",
  prepTime: "",
  cookTime: "",
  servings: 4,
  calories: 0,
  ingredients: [""],
  instructions: "",
  tags: ["Imported"],
};

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function apiRecipeToDraft(recipe: any): DraftRecipe {
  return {
    name: String(recipe?.title || recipe?.name || "").trim(),
    emoji: recipe?.emoji || "📖",
    image: typeof recipe?.image === "string" ? recipe.image : "",
    prepTime: recipe?.prepTime || "",
    cookTime: recipe?.cookTime || "",
    servings: Number(recipe?.servings) || 4,
    calories: Number(recipe?.calories) || 0,
    ingredients: Array.isArray(recipe?.ingredients) && recipe.ingredients.length ? recipe.ingredients : [""],
    instructions: typeof recipe?.instructions === "string" ? recipe.instructions : "",
    tags: Array.isArray(recipe?.tags) && recipe.tags.length ? recipe.tags : ["Imported"],
    sourceUrl: typeof recipe?.sourceUrl === "string" ? recipe.sourceUrl : undefined,
    needsReview: Boolean(recipe?.needsReview),
  };
}

export default function RecipeImportModal({
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
  const [tab, setTab] = useState<ImportTab>("url");
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [draft, setDraft] = useState<DraftRecipe>(EMPTY_DRAFT);
  const [errorMessage, setErrorMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
    if (!draft.sourceUrl) return undefined;
    return recipes.find((r) => r.sourceUrl && r.sourceUrl === draft.sourceUrl);
  }, [recipes, draft.sourceUrl]);

  if (!open) return null;

  const runImport = async (payload: Record<string, unknown>) => {
    setPhase("fetching");
    setErrorMessage("");
    try {
      const res = await fetch("/api/recipes/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.recipe) {
        setErrorMessage(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Import failed. Try again, or paste the recipe text instead.",
        );
        setPhase("error");
        return;
      }
      setDraft(apiRecipeToDraft(data.recipe));
      setPhase("preview");
    } catch {
      setErrorMessage("Could not reach the import service. Check your connection and try again.");
      setPhase("error");
    }
  };

  const handleImportUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!looksLikeUrl(trimmed)) {
      setErrorMessage("That doesn't look like a valid link. It should start with http:// or https://");
      setPhase("error");
      return;
    }
    runImport({ type: "url", url: trimmed, sourceLabel: "Web" });
  };

  const handleImportText = () => {
    const trimmed = pastedText.trim();
    if (trimmed.length < 20) {
      setErrorMessage("Paste a little more of the recipe first (at least a few lines).");
      setPhase("error");
      return;
    }
    runImport({ type: "text", fileText: trimmed, sourceLabel: "Pasted text" });
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setUrl(text.trim());
        setPhase("idle");
        setErrorMessage("");
      } else {
        showToast("📋 Clipboard is empty");
      }
    } catch {
      showToast("📋 Paste into the field instead (clipboard access was blocked)");
    }
  };

  const handleSave = async () => {
    if (!draft.name.trim()) return;
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
      await onSave({
        id: Date.now(),
        name: draft.name.trim(),
        emoji: draft.emoji || "📖",
        prepTime: draft.prepTime || "30 min",
        cookTime: draft.cookTime || undefined,
        tags: draft.tags.filter(Boolean),
        ingredients: draft.ingredients.map((i) => i.trim()).filter(Boolean),
        instructions: draft.instructions,
        servings: Number(draft.servings) || 4,
        calories: Number(draft.calories) || 0,
        source: draft.sourceUrl,
        sourceUrl: draft.sourceUrl,
        createdAt: new Date().toISOString(),
        image: draft.image || undefined,
      });
      setPhase("done");
      closeTimerRef.current = setTimeout(() => onClose(), 900);
    } catch {
      setErrorMessage("Saving failed. Try again.");
      setPhase("error");
    }
  };

  const updateIngredient = (idx: number, val: string) => {
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((ing, i) => (i === idx ? val : ing)) }));
  };

  const toggleTag = (tag: string) => {
    setDraft((d) => ({
      ...d,
      tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag],
    }));
  };

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
            <h2 className="text-text-primary font-bold text-lg">🌐 Import recipe</h2>
            <p className="text-text-muted text-xs">From a link or pasted text — review before saving</p>
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
          {phase === "idle" || phase === "fetching" || phase === "error" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "url", label: "🔗 From URL" },
                    { id: "text", label: "📋 Paste text" },
                  ] as { id: ImportTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      if (phase === "error") setPhase("idle");
                    }}
                    className={`py-2.5 rounded-2xl text-sm font-semibold transition-colors tap-sm cursor-pointer ${
                      tab === t.id
                        ? "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)] border border-[var(--color-accent-selected)]/30"
                        : "glass text-text-secondary border border-[var(--color-surface-3)] hover:text-text-primary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "url" ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleImportUrl();
                      }}
                      placeholder="https://www.allrecipes.com/recipe/…"
                      inputMode="url"
                      autoFocus
                      className={inputClass}
                    />
                    <button
                      onClick={handlePasteFromClipboard}
                      className="shrink-0 px-3 rounded-2xl glass border border-[var(--color-surface-3)] text-text-secondary text-sm font-medium hover:text-text-primary tap-sm cursor-pointer"
                    >
                      Paste
                    </button>
                  </div>
                  <p className="text-text-muted text-xs">
                    Works best with recipe blogs. Sites that block import (Pinterest, TikTok) — use Paste text instead.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={"Paste the recipe here…\n\nName, ingredients, steps — any format works."}
                    rows={8}
                    className={`${inputClass} resize-none`}
                  />
                </div>
              )}

              {phase === "fetching" && (
                <div className="flex items-center gap-3 rounded-2xl glass border border-[var(--color-surface-3)] px-4 py-3">
                  <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" />
                  <p className="text-text-secondary text-sm font-medium">
                    {tab === "url" ? "Fetching the page and extracting the recipe…" : "Parsing your recipe text…"}
                  </p>
                </div>
              )}

              {phase === "error" && errorMessage && (
                <div className="rounded-2xl border border-[var(--color-accent-rose)]/30 bg-[var(--color-accent-rose)]/10 px-4 py-3">
                  <p className="text-sm font-semibold text-text-primary">😕 {errorMessage}</p>
                </div>
              )}

              <button
                onClick={tab === "url" ? handleImportUrl : handleImportText}
                disabled={phase === "fetching"}
                className="w-full py-3.5 rounded-2xl bg-[var(--color-accent-button)] text-white font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed transition-all tap cursor-pointer"
              >
                {phase === "fetching" ? "Importing…" : "Import"}
              </button>
            </>
          ) : phase === "preview" || phase === "saving" || phase === "done" ? (
            <>
              {draft.needsReview && (
                <div className="rounded-2xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 px-4 py-3">
                  <p className="text-sm font-semibold text-text-primary">
                    {"🔍 Couldn't fully parse this one — please check the fields below before saving."}
                  </p>
                </div>
              )}

              {existingByUrl && (
                <div className="rounded-2xl border border-[var(--color-accent-selected)]/30 bg-[var(--color-accent-selected)]/10 px-4 py-3">
                  <p className="text-sm font-semibold text-text-primary">
                    {`✓ Already in your catalog as "${existingByUrl.name}"`}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center text-4xl hover:bg-surface-3 transition-colors border-2 border-dashed border-surface-4 hover:border-[var(--color-accent-selected)]/40 cursor-pointer"
                  >
                    {draft.emoji}
                  </button>
                  {showEmojiPicker && (
                    <div
                      className="absolute top-full left-0 mt-2 z-50 p-3 rounded-2xl shadow-2xl"
                      style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-surface-4)", width: "260px" }}
                    >
                      <p className="text-text-muted text-xs mb-2">Choose an emoji</p>
                      <div className="grid grid-cols-8 gap-1">
                        {foodEmojis.map((e) => (
                          <button
                            key={e}
                            onClick={() => {
                              setDraft((d) => ({ ...d, emoji: e }));
                              setShowEmojiPicker(false);
                            }}
                            className={`w-8 h-8 rounded-lg text-xl flex items-center justify-center hover:bg-[var(--color-accent-selected)]/20 transition-colors cursor-pointer ${draft.emoji === e ? "bg-[var(--color-accent-selected)]/20" : ""}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Recipe name…"
                  className="flex-1 bg-surface-2 text-text-primary text-base font-semibold rounded-2xl px-4 py-3 outline-none placeholder:text-text-muted border border-surface-3 focus:border-[var(--color-accent-selected)]/50 transition-colors"
                />
              </div>

              <div>
                <p className="text-text-secondary text-xs font-semibold mb-2">📸 Photo</p>
                <div className="flex items-center gap-3">
                  <div className="relative w-20 h-20 rounded-2xl overflow-hidden bg-surface-2 border border-surface-3 flex items-center justify-center shrink-0">
                    {draft.image ? (
                      <>
                        <img src={draft.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setDraft((d) => ({ ...d, image: "" }))}
                          aria-label="Remove photo"
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="text-2xl text-text-muted">📷</span>
                    )}
                  </div>
                  <input
                    value={draft.image}
                    onChange={(e) => setDraft((d) => ({ ...d, image: e.target.value }))}
                    placeholder="Image URL…"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Prep time</label>
                  <input
                    value={draft.prepTime}
                    onChange={(e) => setDraft((d) => ({ ...d, prepTime: e.target.value }))}
                    placeholder="e.g. 15 min"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Cook time</label>
                  <input
                    value={draft.cookTime}
                    onChange={(e) => setDraft((d) => ({ ...d, cookTime: e.target.value }))}
                    placeholder="e.g. 30 min"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Servings</label>
                  <input
                    type="number"
                    min={1}
                    value={draft.servings || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, servings: Number(e.target.value) }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Calories</label>
                  <input
                    type="number"
                    min={0}
                    value={draft.calories || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, calories: Number(e.target.value) }))}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-text-secondary text-xs font-semibold">🧂 Ingredients</p>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, ingredients: [...d.ingredients, ""] }))}
                    className="text-[var(--color-accent-selected)] text-xs cursor-pointer"
                  >
                    + Add
                  </button>
                </div>
                <div className="space-y-2">
                  {draft.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-text-muted text-xs w-5 text-center">{idx + 1}.</span>
                      <input
                        value={ing}
                        onChange={(e) => updateIngredient(idx, e.target.value)}
                        placeholder={`Ingredient ${idx + 1}…`}
                        className={`flex-1 bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted`}
                      />
                      {draft.ingredients.length > 1 && (
                        <button
                          onClick={() =>
                            setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, i) => i !== idx) }))
                          }
                          aria-label="Remove ingredient"
                          className="p-1.5 text-text-muted hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-text-secondary text-xs font-semibold mb-2">📋 Instructions</p>
                <textarea
                  value={draft.instructions}
                  onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
                  placeholder="Step-by-step instructions…"
                  rows={4}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div>
                <p className="text-text-secondary text-xs font-semibold mb-2">🏷️ Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {RECIPE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                        draft.tags.includes(tag)
                          ? "bg-[var(--color-accent-selected)]/20 text-[var(--color-accent-selected)] border border-[var(--color-accent-selected)]/30"
                          : "bg-surface-2 text-text-muted border border-surface-3 hover:text-text-primary"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {draft.sourceUrl && (
                <p className="text-text-muted text-[11px] break-all">
                  Source: <span className="text-text-secondary">{draft.sourceUrl}</span>
                </p>
              )}
            </>
          ) : null}
        </div>

        {(phase === "preview" || phase === "saving" || phase === "done") && (
          <div
            className="px-5 py-4 border-t border-surface-3 flex gap-2"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <button
              onClick={() => {
                setPhase("idle");
                setDraft(EMPTY_DRAFT);
              }}
              disabled={phase === "saving"}
              className="flex-1 py-3.5 rounded-2xl glass border border-[var(--color-surface-3)] text-text-secondary font-bold text-sm hover:text-text-primary transition-colors tap-sm cursor-pointer disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              disabled={!draft.name.trim() || phase === "saving" || phase === "done"}
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
      </div>
    </div>,
    document.body,
  );
}
