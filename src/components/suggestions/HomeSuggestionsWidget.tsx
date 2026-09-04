/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import EmptyState from "@/components/ui/EmptyState";
import Toast from "@/components/ui/Toast";
import { useSuggestions } from "./hooks/useSuggestions";
import SuggestionPinModal from "./SuggestionPinModal";
import { useAuth } from "@/hooks/useAuth";
import type { ProactiveSuggestion } from "@/lib/consuela/types";

// Kitchen/grocery ops are the parents' domain — surfacing "assign stores" or
// "pantry low" on a child's Home is noise they can't act on (the action needs
// a parent PIN). Chores and calendar conflicts stay visible to kids.
const PARENT_ONLY_SUGGESTION_KINDS = new Set(["grocery_store_optimization", "pantry_low"]);

const TOOL_ROUTES: Record<string, string> = {
  get_pending_tasks: "/tasks",
  get_weekly_meals: "/meals",
  get_grocery_list: "/meals",
  open_calendar: "/calendar",
};

export function suggestionActionRoute(suggestion: ProactiveSuggestion): string | null {
  const tool = suggestion.actionPayload?.tool;
  return tool && TOOL_ROUTES[tool] ? TOOL_ROUTES[tool] : null;
}

function SuggestionRow({
  suggestion,
  onDismiss,
  onAct,
}: {
  suggestion: ProactiveSuggestion;
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
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">{suggestion.body}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {suggestion.actionLabel &&
            (route ? (
              <Link href={route}>
                <SoftButton size="sm" variant="secondary">{suggestion.actionLabel}</SoftButton>
              </Link>
            ) : (
              <SoftButton size="sm" variant="secondary" loading={acting} onClick={handleAct}>
                {suggestion.actionLabel}
              </SoftButton>
            ))}
          <IconButton size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => onDismiss(suggestion.id)}>
            <span>×</span>
          </IconButton>
        </div>
      </div>
    </Surface>
  );
}

export default function HomeSuggestionsWidget({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: "success" | "error" } | null>(null);
  const { currentUser } = useAuth();
  const isChild = currentUser?.role === "child";
  const { items: allItems, loading, dismiss, act, needsPin, pinError, submitPin, cancelPin } = useSuggestions(20);
  const items = isChild
    ? allItems.filter((s) => !PARENT_ONLY_SUGGESTION_KINDS.has(s.kind))
    : allItems;

  useEffect(() => {
    setMounted(true);
  }, []);

  const showToast = (msg: string, tone: "success" | "error") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAct = async (suggestion: ProactiveSuggestion) => {
    const res = await act(suggestion);
    if (res.prompted) return; // queued for the PIN modal — no error toast
    if (res.ok) showToast(`✅ ${res.message}`, "success");
    else showToast(`⚠️ ${res.message}`, "error");
  };

  const handleDismiss = async (id: string) => {
    const res = await dismiss(id);
    if (res && !res.ok && !res.prompted) showToast(`⚠️ ${res.message}`, "error");
  };

  if (!mounted) {
    return (
      <SectionCard title="Consuela suggests" icon="✨" tone="#8b5cf6" centeredHeader className={className}>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  const pinModal = (
    <SuggestionPinModal open={needsPin} error={pinError} onClose={cancelPin} onSubmit={submitPin} />
  );

  if (items.length === 0 && !loading) {
    return (
      <SectionCard
        title="Consuela suggests"
        icon="✨"
        tone="#8b5cf6"
        centeredHeader
        className={className}
        action={<Link href="/suggestions" className="text-sm widget-accent-text">See all →</Link>}
      >
        <EmptyState
          title="All clear"
          description="Consuela is watching the pantry, tasks, and calendar — she'll surface something here when it needs attention."
          icon="🧘"
          flat
        />
        {toast && <Toast open tone={toast.tone}>{toast.msg}</Toast>}
        {pinModal}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Consuela suggests"
      description="Proactive alerts for the family"
      icon="✨"
      tone="#8b5cf6"
      centeredHeader
      className={className}
      action={<Link href="/suggestions" className="text-sm widget-accent-text">See all →</Link>}
    >
      {items.length === 0 && loading ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {items.slice(0, 2).map((suggestion) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion} onDismiss={handleDismiss} onAct={handleAct} />
          ))}
        </div>
      )}
      {items.length > 2 && (
        <div className="mt-3 shrink-0 border-t border-white/10 pt-3">
          <Link href="/suggestions" className="tap-sm text-xs font-semibold widget-accent-text">
            +{items.length - 2} more · See all →
          </Link>
        </div>
      )}
      {toast && <Toast open tone={toast.tone}>{toast.msg}</Toast>}
      {pinModal}
    </SectionCard>
  );
}
