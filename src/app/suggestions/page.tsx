/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useSuggestions } from "@/components/suggestions/hooks/useSuggestions";
import SuggestionPinModal from "@/components/suggestions/SuggestionPinModal";
import { suggestionActionRoute } from "@/components/suggestions/HomeSuggestionsWidget";
import Toast from "@/components/ui/Toast";
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
  grocery_store_optimization: "🛒 Grocery",
  custom: "✨ Custom",
};

function SuggestionCard({
  suggestion,
  busy = false,
  onSnooze,
  onDismiss,
  onAct,
}: {
  suggestion: ProactiveSuggestion;
  busy?: boolean;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
  onAct: (suggestion: ProactiveSuggestion) => Promise<void>;
}) {
  const route = suggestionActionRoute(suggestion);
  const [acting, setActing] = useState(false);

  const handleAct = async () => {
    setActing(true);
    try {
      await onAct(suggestion);
    } finally {
      setActing(false);
    }
  };

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
                  <SoftButton size="sm" variant="secondary" disabled={busy}>{suggestion.actionLabel}</SoftButton>
                </Link>
              ) : (
                <SoftButton size="sm" variant="secondary" loading={acting} disabled={busy} onClick={handleAct}>
                  {suggestion.actionLabel}
                </SoftButton>
              ))}
            <SoftButton size="sm" variant="ghost" disabled={busy} onClick={() => onSnooze(suggestion.id)} title="Snooze until tomorrow">
              Snooze
            </SoftButton>
          </div>
        </div>
        <IconButton variant="ghost" aria-label="Dismiss suggestion" disabled={busy} onClick={() => onDismiss(suggestion.id)}>
          <span>×</span>
        </IconButton>
      </div>
    </Surface>
  );
}

export default function SuggestionsPage() {
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [toast, setToast] = useState<{ msg: string; tone: "success" | "error" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { items, loading, refresh, dismiss, snooze, act, needsPin, pinError, submitPin, cancelPin } =
    useSuggestions(100);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (msg: string, tone: "success" | "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  const handleAct = async (suggestion: ProactiveSuggestion) => {
    const res = await act(suggestion);
    if (res.prompted) return; // queued for the PIN modal — no error toast
    if (res.ok) showToast(`✅ ${res.message}`, "success");
    else showToast(`⚠️ ${res.message}`, "error");
  };

  const runWithBusy = async (id: string, run: () => Promise<void>) => {
    setBusyId(id);
    try {
      await run();
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = (id: string) =>
    runWithBusy(id, async () => {
      const res = await dismiss(id);
      if (res && !res.ok && !res.prompted) showToast(`⚠️ ${res.message}`, "error");
    });

  const handleSnooze = (id: string) =>
    runWithBusy(id, async () => {
      const res = await snooze(id);
      if (res && !res.ok && !res.prompted) showToast(`⚠️ ${res.message}`, "error");
      else if (res && res.ok) showToast("😴 Snoozed until tomorrow", "success");
    });

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
          <IconButton aria-label="Refresh suggestions" onClick={refresh} disabled={loading}>
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
              <Skeleton key={i} className="h-16 rounded-2xl" />
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
                busy={busyId === suggestion.id}
                onSnooze={handleSnooze}
                onDismiss={handleDismiss}
                onAct={handleAct}
              />
            ))}
          </div>
        )}
        {toast && <Toast open tone={toast.tone}>{toast.msg}</Toast>}
      </div>
      <SuggestionPinModal open={needsPin} error={pinError} onClose={cancelPin} onSubmit={submitPin} />
    </PageShell>
  );
}
