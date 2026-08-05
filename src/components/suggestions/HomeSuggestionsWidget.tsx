/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import EmptyState from "@/components/ui/EmptyState";
import { useSuggestions } from "./hooks/useSuggestions";
import type { ProactiveSuggestion } from "@/lib/consuela/types";

const TOOL_ROUTES: Record<string, string> = {
  add_grocery_item: "/grocery",
  get_pending_tasks: "/tasks",
  get_weekly_meals: "/meals",
  open_calendar: "/calendar",
};

export function suggestionActionRoute(suggestion: ProactiveSuggestion): string | null {
  const tool = suggestion.actionPayload?.tool;
  return tool && TOOL_ROUTES[tool] ? TOOL_ROUTES[tool] : null;
}

function SuggestionRow({
  suggestion,
  onDismiss,
}: {
  suggestion: ProactiveSuggestion;
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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {suggestion.actionLabel &&
            (route ? (
              <Link href={route}>
                <SoftButton size="sm" variant="secondary">{suggestion.actionLabel}</SoftButton>
              </Link>
            ) : (
              <SoftButton size="sm" variant="secondary">{suggestion.actionLabel}</SoftButton>
            ))}
          <IconButton size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => onDismiss(suggestion.id)}>
            <span>×</span>
          </IconButton>
        </div>
      </div>
    </Surface>
  );
}

export default function HomeSuggestionsWidget() {
  const [mounted, setMounted] = useState(false);
  const { items, loading, dismiss } = useSuggestions(20);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <SectionCard title="Consuela suggests" icon="✨">
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (items.length === 0 && !loading) {
    return (
      <SectionCard
        title="Consuela suggests"
        icon="✨"
        action={<Link href="/suggestions" className="text-sm text-[var(--color-accent-selected)]">See all →</Link>}
      >
        <EmptyState
          title="All clear"
          description="Consuela is watching the pantry, tasks, and calendar — she'll surface something here when it needs attention."
          icon="🧘"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Consuela suggests"
      description="Proactive alerts for the family"
      icon="✨"
      action={<Link href="/suggestions" className="text-sm text-[var(--color-accent-selected)]">See all →</Link>}
    >
      {items.length === 0 && loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((suggestion) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
