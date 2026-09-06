"use client";

/**
 * OpenLoopChips — the quick-action row beneath the FamilyBrief. When the
 * suggestion engine has notices, the family's ACTUAL open loops become the
 * chips (tap = editable draft, never a one-tap write). When the engine is
 * empty or loading, the honest fallbacks are the name-neutral static
 * category drafts. Kid-filtering reuses the shared visibility rule so chat
 * and the Home widget never disagree.
 *
 * Actionable loops (the engine attached actionPayload) grow a separate
 * "Do it" control that runs the SAME PIN-gated act flow as the Home widget
 * — the primary tap still drafts; the write always passes a confirm gate.
 */

import { useMemo } from "react";
import { useSuggestions } from "@/components/suggestions/hooks/useSuggestions";
import SuggestionPinModal from "@/components/suggestions/SuggestionPinModal";
import { visibleSuggestionsForRole } from "@/lib/consuela/suggestion-visibility";
import { conditionKey } from "@/lib/consuela/suggestion-key";
import { Icon3D } from "@/components/3d";
import type { ProactiveSuggestion } from "@/lib/consuela/types";

interface OpenLoopChipsProps {
  onDraft: (text: string) => void;
  /** Session role — child sessions never see parent-only kinds. */
  role?: string;
}

const STATIC_FALLBACKS = [
  { icon: "calendar" as const, label: "Add Event", prompt: "Add soccer practice tomorrow at 4pm" },
  { icon: "meals" as const, label: "Plan Meals", prompt: "Plan dinners for this week" },
  { icon: "tasks" as const, label: "Assign Chore", prompt: "Assign trash duty every Thursday with 10 points" },
  { icon: "grocery" as const, label: "Grocery List", prompt: "Generate grocery list for this week's meals" },
];

const MAX_LOOPS = 4;

export function OpenLoopChips({ onDraft, role }: OpenLoopChipsProps) {
  const { items, loading, act, needsPin, pinError, submitPin, cancelPin } = useSuggestions(20);

  const loops = useMemo(() => {
    const pending = items.filter((s) => s.status === "pending" && !s.snoozedUntil);
    const visible = visibleSuggestionsForRole(pending, role);
    // Runtime dedupe by the engine's own condition identity: insert-time
    // normalization can't heal stale pre-fix rows still living in PB, and
    // "Consuela noticed" showing two versions of one condition is a trust
    // bug. Newest wins: the feed is sorted -createdAt (NEWEST FIRST,
    // pb-db.ts selectPendingSuggestions), so the FIRST occurrence per key
    // is the freshest scan — keep it, skip later stale duplicates.
    const byKey = new Map<string, ProactiveSuggestion>();
    for (const s of visible) {
      const key = conditionKey(s.kind, s.title);
      if (!byKey.has(key)) byKey.set(key, s);
    }
    return Array.from(byKey.values()).slice(0, MAX_LOOPS);
  }, [items, role]);

  if (loading) {
    return (
      <p className="text-xs text-text-secondary text-center" role="status">
        Seeing what needs doing…
      </p>
    );
  }

  if (loops.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 w-full" aria-label="Quick starts">
        {STATIC_FALLBACKS.map((a) => (
          <button
            key={a.label}
            onClick={() => onDraft(a.prompt)}
            className="liquid-glass flex items-center gap-4 px-5 py-4 text-left"
            style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 16%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 6%, transparent) 100%)" }}
          >
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 28%, transparent), color-mix(in srgb, var(--color-accent-selected) 12%, transparent))" }}
            >
              <Icon3D variant={a.icon} size="md" animated={false} className="w-6 h-6" />
            </span>
            <span className="text-sm font-medium text-text-primary">{a.label}</span>
          </button>
        ))}
      </div>
    );
  }

  const renderChip = (s: ProactiveSuggestion) => {
    const actionable = Boolean(s.actionPayload?.tool);
    return (
      <div
        key={s.id}
        className="liquid-glass flex items-center gap-3 px-4 py-3 text-left rounded-2xl relative"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 14%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 5%, transparent) 100%)" }}
      >
        <button
          onClick={() => onDraft(`${s.title} — can you help with that?`)}
          aria-label={`${s.title} — draft a message`}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
        >
          <span className="text-xl shrink-0" aria-hidden>{s.emoji || "💭"}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Consuela noticed</span>
            <span className="block text-sm font-medium text-text-primary line-clamp-2">{s.title}</span>
          </span>
        </button>
        {actionable && (
          <button
            onClick={() => act(s)}
            aria-label={`Do it: ${s.actionLabel ?? s.title}`}
            title={`Do it: ${s.actionLabel ?? s.title}`}
            // 36px visual; the ::after -inset-1 grows the HIT AREA to 44px
            // (before:-inset is dead on glass-* surfaces — the material
            // ::before wins — so the documented pattern uses ::after).
            className="tap-sm relative shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-white bg-[var(--color-accent-button,var(--color-accent-selected))] min-h-[36px] after:absolute after:-inset-1 after:content-['']"
          >
            {s.actionLabel ?? "Do it"}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full" aria-label="What Consuela noticed">
        {loops.map(renderChip)}
      </div>
      {/* Shared PIN gate — same flow as the Home suggestions widget. */}
      <SuggestionPinModal open={needsPin} error={pinError} onClose={cancelPin} onSubmit={submitPin} />
    </>
  );
}
