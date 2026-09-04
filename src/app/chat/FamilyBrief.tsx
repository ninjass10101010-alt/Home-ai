/* eslint-disable react-hooks/set-state-in-effect -- fetch-on-mount + refresh listeners: setState lands after await, the rule can't see through the async boundary (same disable as page.tsx / Modal.tsx / useSuggestions.ts) */
"use client";

/**
 * FamilyBrief — the Ask Consuela opening state: the family's day as
 * Consuela already holds it. Dinner from the meal plan, the next event
 * today, and who's speaking. Every card is tap-to-draft; nothing here
 * ever writes family data on one tap (the kid-safety rule).
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { db } from "@/db";
import { dinnerForToday, nextEventToday, eventCountdown } from "@/lib/consuela/chat-context";
import { localWeekStartISO, localWeekdayShort } from "@/lib/local-date";

interface FamilyBriefProps {
  speaker: { name: string; emoji: string; color: string };
  onDraft: (text: string) => void;
  onSpeakerTap: () => void;
  /** Compact single-line strip rendered above an active thread. */
  compact?: boolean;
  /** Signed-in members speak as themselves — the speaker card is identity, not a switch. */
  signedIn?: boolean;
}

export function FamilyBrief({ speaker, onDraft, onSpeakerTap, compact = false, signedIn = false }: FamilyBriefProps) {
  const [meals, setMeals] = useState<Array<{ name: string; mealType?: string; time: string; weekOf?: string }>>([]);
  const [events, setEvents] = useState<Array<{ title: string; time: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  const read = useCallback(async (cancelledRef: { current: boolean }) => {
    try {
      // db.selectMeals() is dual-mode: a Promise (PB path) or a plain array
      // (local cache path) — await handles both; sync throws from a missing
      // client method are caught here so the brief degrades honestly instead
      // of hanging at "…" forever.
      const wrap = <T,>(v: T | Promise<T>): Promise<T> => Promise.resolve(v);
      const [m, e] = await Promise.all([
        wrap(db.selectMeals?.() ?? []).catch(() => []),
        wrap(db.selectTodaysEvents?.() ?? []).catch(() => []),
      ]);
      if (cancelledRef.current) return;
      setMeals(Array.isArray(m) ? m : []);
      setEvents(Array.isArray(e) ? e : []);
    } catch {
      if (!cancelledRef.current) setMeals([]);
    } finally {
      if (!cancelledRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const cancelled = { current: false };
    read(cancelled);
    return () => { cancelled.current = true; };
  }, [read]);

  // Live brief: the 60s CacheRefresher dispatches consuela-data-refreshed when
  // any device writes family data — re-read so a dinner logged mid-session
  // flips the card without a reload.
  useEffect(() => {
    const cancelled = { current: false };
    const onRefresh = () => { read(cancelled); };
    document.addEventListener("consuela-data-refreshed", onRefresh);
    return () => {
      cancelled.current = true;
      document.removeEventListener("consuela-data-refreshed", onRefresh);
    };
  }, [read]);

  // Clock tick: recomputes countdowns as time passes, ages events into
  // "Quiet rest of day", and rolls week/weekday over at midnight.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setClockTick((v) => v + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // `now` re-derivies from the LIVE clock (clockTick is its dependency — the
  // lint's "unnecessary dependency" note is how the tick reaches the memos).
  // A kitchen tablet left open past midnight must stop matching yesterday's
  // weekday/week, and countdowns must recompute as time passes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clockTick is the deliberate recompute trigger
  const now = useMemo(() => new Date(), [clockTick]);
  const week = useMemo(() => localWeekStartISO(now), [now]);
  const weekday = useMemo(() => localWeekdayShort(now), [now]);
  const dinner = useMemo(() => dinnerForToday(meals, week, weekday), [meals, week, weekday]);
  const nextRaw = useMemo(() => nextEventToday(events, now), [events, now]);
  const countdown = useMemo(
    () => (nextRaw ? eventCountdown(nextRaw.time, now) : null),
    [nextRaw, now]
  );
  const next = nextRaw ? { ...nextRaw, countdown } : null;

  if (compact) {
    const parts: string[] = [];
    if (dinner) parts.push(`🍽️ ${dinner.name}`);
    if (next) parts.push(`📅 ${next.title}${next.countdown ? ` · ${next.countdown}` : ` · ${next.time}`}`);
    if (parts.length === 0) return null;
    return (
      <div className="w-full px-3 py-2 rounded-2xl glass-subtle text-[11px] text-text-secondary flex items-center gap-2 overflow-hidden" role="status" aria-label="Today at a glance">
        <span className="shrink-0 font-semibold text-text-primary">{speaker.emoji} {speaker.name.split(" ")[0]}</span>
        <span className="truncate min-w-0">{parts.join("  ·  ")}</span>
        {!signedIn && (
          <button
            onClick={onSpeakerTap}
            aria-label="Switch speaker"
            className="tap-sm relative shrink-0 rounded-full px-2 py-1.5 text-[11px] font-semibold text-[var(--color-accent-selected)] before:absolute before:-inset-1.5 before:content-['']"
          >
            switch
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full grid grid-cols-1 gap-3" aria-label="The family's day">
      {/* Dinner */}
      <button
        onClick={() => onDraft(dinner ? `What's for dinner tonight? I see ${dinner.name} is planned — remind me what's in it?` : "What should we have for dinner tonight?")}
        className="liquid-glass flex items-center gap-3 px-4 py-3.5 text-left rounded-2xl"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 14%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 5%, transparent) 100%)" }}
      >
        <span className="text-2xl shrink-0" aria-hidden>{dinner ? "🍽️" : "🤷"}</span>
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Dinner</span>
          <span className="block text-sm font-semibold text-text-primary truncate">
            {loaded ? (dinner ? dinner.name : "Nothing planned yet") : "…"}
          </span>
        </span>
      </button>

      {/* Next up */}
      <button
        onClick={() => onDraft(next ? `Tell me about ${next.title} at ${next.time}` : "What's coming up on the calendar?")}
        className="liquid-glass flex items-center gap-3 px-4 py-3.5 text-left rounded-2xl"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 14%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 5%, transparent) 100%)" }}
      >
        <span className="text-2xl shrink-0" aria-hidden>{next ? next.title.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)?.[0] ?? "📅" : "🌙"}</span>
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Next up</span>
          <span className="block text-sm font-semibold text-text-primary truncate">
            {next ? `${next.title}${next.countdown ? ` · ${next.countdown}` : ` · ${next.time}`}` : "Quiet rest of day"}
          </span>
        </span>
      </button>

      {/* Speaker — a switch for guests; identity for signed-in members */}
      {signedIn ? (
        <div
          className="liquid-glass flex items-center gap-3 px-4 py-3.5 text-left rounded-2xl"
          style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 14%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 5%, transparent) 100%)" }}
          aria-label={`You're signed in as ${speaker.name}`}
        >
          <span className="text-2xl shrink-0" aria-hidden>{speaker.emoji}</span>
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Speaking as</span>
            <span className="block text-sm font-semibold text-text-primary truncate">
              {speaker.name.split(" ")[0]}
            </span>
          </span>
        </div>
      ) : (
        <button
          onClick={onSpeakerTap}
          aria-label={`Speaking as ${speaker.name} — switch`}
          className="liquid-glass flex items-center gap-3 px-4 py-3.5 text-left rounded-2xl"
          style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 14%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 5%, transparent) 100%)" }}
        >
          <span className="text-2xl shrink-0" aria-hidden>{speaker.emoji}</span>
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-text-secondary">Speaking as</span>
            <span className="block text-sm font-semibold text-text-primary truncate">
              {speaker.name.split(" ")[0]}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

/** Exported for tests: the honest empty phrase lives in one place. */
export const NO_DINNER_COPY = "Nothing planned yet";
