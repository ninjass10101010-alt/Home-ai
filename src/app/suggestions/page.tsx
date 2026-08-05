/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import { useSuggestions } from "@/components/suggestions/hooks/useSuggestions";
import { suggestionActionRoute } from "@/components/suggestions/HomeSuggestionsWidget";
import type { ProactiveSuggestion, SuggestionKind } from "@/lib/consuela/types";

type FilterKind = "all" | SuggestionKind;

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pantry_low", label: "🥫 Pantry" },
  { id: "task_penalty_streak", label: "⚠️ Tasks" },
  { id: "calendar_conflict", label: "📅 Calendar" },
  { id: "stale_data", label: "🍽️ Meals" },
];

const KIND_LABELS: Record<SuggestionKind, string> = {
  pantry_low: "🥫 Pantry",
  task_penalty_streak: "⚠️ Tasks",
  calendar_conflict: "📅 Calendar",
  stale_data: "🍽️ Meals",
  custom: "✨ Custom",
};

function SuggestionCard({
  suggestion,
  onSnooze,
  onDismiss,
}: {
  suggestion: ProactiveSuggestion;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const route = suggestionActionRoute(suggestion);

  return (
    <Surface variant="glass-subtle" radius="xl" padding="sm">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0">{suggestion.emoji || "✨"}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{suggestion.title}</div>
          {suggestion.body && (
            <div className="mt-1 text-xs leading-5 text-text-muted">{suggestion.body}</div>
          )}
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            {KIND_LABELS[suggestion.kind]} · {suggestion.scopeDate}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {suggestion.actionLabel &&
              (route ? (
                <Link href={route}>
                  <SoftButton size="sm" variant="secondary">{suggestion.actionLabel}</SoftButton>
                </Link>
              ) : (
                <SoftButton size="sm" variant="secondary">{suggestion.actionLabel}</SoftButton>
              ))}
            <SoftButton size="sm" variant="ghost" onClick={() => onSnooze(suggestion.id)} title="Snooze until tomorrow">
              Snooze
            </SoftButton>
          </div>
        </div>
        <IconButton size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => onDismiss(suggestion.id)}>
          <span>×</span>
        </IconButton>
      </div>
    </Surface>
  );
}

export default function SuggestionsPage() {
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const { items, loading, refresh, dismiss, snooze } = useSuggestions(100);

  useEffect(() => {
    setMounted(true);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const s of items) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = filter === "all" ? items : items.filter((s) => s.kind === filter);

  if (!mounted) {
    return (
      <PageShell>
        <PageHeader title="Consuela's Suggestions" subtitle="Loading..." icon="✨" />
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Consuela's Suggestions"
        subtitle={items.length > 0 ? `${items.length} waiting for your attention` : "Proactive alerts from Consuela"}
        icon="✨"
        action={
          <IconButton aria-label="Refresh suggestions" onClick={refresh}>
            <span>↻</span>
          </IconButton>
        }
      />

      <div className="px-4 pb-8 space-y-5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {counts[f.id] !== undefined && counts[f.id] > 0 ? ` (${counts[f.id]})` : ""}
            </Chip>
          ))}
        </div>

        {loading && filtered.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🧘"
            title={filter === "all" ? "All clear" : "Nothing here"}
            description={
              filter === "all"
                ? "No proactive suggestions right now. Consuela will surface pantry, task, calendar, and meal alerts here as she spots them."
                : "No suggestions in this category right now."
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onSnooze={snooze}
                onDismiss={dismiss}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
