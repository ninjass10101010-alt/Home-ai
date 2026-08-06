"use client";

import { useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import WidgetCard from "@/components/patterns/WidgetCard";
import Chip from "@/components/ui/Chip";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import { briefingSectionsEmpty } from "./hooks/useMorningBriefing";
import type { MorningBriefing } from "./hooks/useMorningBriefing";

const BRIEFING_TONE = "#f97316";

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function totalCount(briefing: MorningBriefing): number {
  const s = briefing.summary;
  if (!s) return 0;
  return (
    (Array.isArray(s.events) ? s.events.length : 0) +
    (Array.isArray(s.tasks) ? s.tasks.length : 0) +
    (Array.isArray(s.meals) ? s.meals.length : 0) +
    (Array.isArray(s.suggestions) ? s.suggestions.length : 0)
  );
}

function SectionLabel({ emoji, label, count }: { emoji: string; label: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-base">{emoji}</span>
      <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">{label}</span>
      <span className="ml-auto rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-semibold text-text-muted">
        {count}
      </span>
    </div>
  );
}

function Row({ icon, title, meta }: { icon: string; title: string; meta?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-[var(--color-surface-0)]/40 px-3 py-2">
      <span className="shrink-0 text-lg">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">{title}</div>
        {meta && <div className="truncate text-xs text-text-muted">{meta}</div>}
      </div>
    </div>
  );
}

export interface MorningBriefingWidgetProps {
  briefing: MorningBriefing | null;
  loading: boolean;
  ack: (id: string) => Promise<boolean>;
  ackError: boolean;
}

export default function MorningBriefingWidget({ briefing, loading, ack, ackError }: MorningBriefingWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  if (loading || !briefing || briefingSectionsEmpty(briefing)) return null;

  const summary = briefing.summary!;
  const count = totalCount(briefing);

  const handleGotIt = async () => {
    setAcknowledging(true);
    try {
      // L4 — only collapse on a confirmed ack; a failed PATCH keeps the card
      // expanded so the rollback + error toast stay visible.
      const ok = await ack(briefing.id);
      if (ok) setExpanded(false);
    } finally {
      setAcknowledging(false);
    }
  };

  if (briefing.acknowledged) {
    return (
      <div className="opacity-60 transition-opacity duration-700">
        <WidgetCard tone={BRIEFING_TONE} icon="🌅">
          <div className="flex items-center gap-3 p-5 pl-14">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-text-primary">Morning Briefing</h3>
              <p className="mt-0.5 text-xs text-text-secondary">Seen for today — Consuela will refresh it tomorrow</p>
            </div>
            <Chip size="sm" tone="success">Acknowledged ✓</Chip>
          </div>
        </WidgetCard>
      </div>
    );
  }

  return (
    <SectionCard
      title="Morning Briefing"
      description="What Consuela lined up for today"
      icon="🌅"
      tone={BRIEFING_TONE}
      action={
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse morning briefing" : "Expand morning briefing"}
          className="tap-sm inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent-selected)]/25 bg-[var(--color-surface-0)]/20 px-3 py-1 text-xs font-semibold widget-accent-text"
        >
          {count} item{count !== 1 ? "s" : ""} <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
      }
    >
      {expanded ? (
        <div className="space-y-4">
          {summary.events.length > 0 && (
            <div className="space-y-2">
              <SectionLabel emoji="📅" label="Today's events" count={summary.events.length} />
              {summary.events.slice(0, 5).map((event, i) => (
                <Row key={str(event.id, `event-${i}`)} icon={str(event.icon, "📅")} title={str(event.title, "Untitled event")} meta={str(event.time)} />
              ))}
            </div>
          )}

          {summary.tasks.length > 0 && (
            <div className="space-y-2">
              <SectionLabel emoji="✅" label="Priority tasks" count={summary.tasks.length} />
              {summary.tasks
                .slice()
                .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))
                .slice(0, 6)
                .map((task, i) => (
                  <Row
                    key={str(task.id, `task-${i}`)}
                    icon="✅"
                    title={str(task.title, "Untitled task")}
                    meta={`${str(task.assigned, str(task.assignee, "Anyone"))} · ${Number(task.points) || 0} pts`}
                  />
                ))}
            </div>
          )}

          {summary.meals.length > 0 && (
            <div className="space-y-2">
              <SectionLabel emoji="🍽️" label="Meals" count={summary.meals.length} />
              {summary.meals.map((meal, i) => (
                <Row
                  key={str(meal.id, `meal-${i}`)}
                  icon={str(meal.emoji, "🍽️")}
                  title={str(meal.name, "Untitled meal")}
                  meta={[str(meal.mealType), str(meal.time)].filter(Boolean).join(" · ")}
                />
              ))}
            </div>
          )}

          {summary.suggestions.length > 0 && (
            <div className="space-y-2">
              <SectionLabel emoji="✨" label="Consuela's noticed" count={summary.suggestions.length} />
              {summary.suggestions.slice(0, 5).map((s, i) => (
                <Row
                  key={str(s.id, `suggestion-${i}`)}
                  icon={str(s.emoji, "✨")}
                  title={str(s.title, "Suggestion")}
                  meta={str(s.body)}
                />
              ))}
            </div>
          )}

          <SoftButton size="md" variant="primary" className="w-full" loading={acknowledging} onClick={handleGotIt}>
            Got it ✓
          </SoftButton>
          {ackError && (
            <Toast open tone="error">
              Couldn&apos;t save — try again
            </Toast>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Tap the badge above to see today’s plan.</p>
      )}
    </SectionCard>
  );
}
