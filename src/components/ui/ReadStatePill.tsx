"use client";

import { READ_COPY, READ_RETRY_LABEL, type ReadFailure } from "@/lib/read-state";

/**
 * ReadStatePill — the one-line version of `ErrorState`, for the places where a
 * `min-h-56` card cannot go: a bento widget on Home, a list header, a section
 * inside a card.
 *
 * Why it exists (audit P0-4): `ErrorState` is the right answer for a whole
 * screen, but every bento widget that hit a failed read had exactly two
 * options — render nothing (a silent lie) or render the big card (a layout
 * bomb). Both were skipped, which is how "Loading…" and "Quiet day" ended up
 * standing in for "the NAS is unreachable".
 *
 * It is `role="status"` + `aria-live="polite"` on purpose: on a wall display
 * nobody taps the screen to re-check, so a state change must be announced to
 * assistive tech without stealing focus.
 */
const TONE: Record<ReadFailure, { icon: string; accent: string }> = {
  // `empty` is not an alarm — it gets the neutral mint/accent rather than rose.
  empty: { icon: "", accent: "var(--color-accent-mint)" },
  offline: { icon: "📴", accent: "var(--color-accent-amber)" },
  unauthorised: { icon: "🔐", accent: "var(--color-accent-amber)" },
  error: { icon: "⚠️", accent: "var(--color-accent-rose)" },
};

export interface ReadStatePillProps {
  /** The failure to explain. Healthy (`loading` / `ready`) reads render nothing. */
  state: ReadFailure;
  /** Overrides the shared copy — pass `READ_COPY_STALE` when usable data is still on screen. */
  message?: string;
  /** Prefixes the copy with the thing that failed, e.g. "Google Calendar". */
  subject?: string;
  /** Wire this to a real re-read. Without it the pill is decoration, which is the P2-1 mistake. */
  onRetry?: () => void;
  retryLabel?: string;
  busyLabel?: string;
  /** True while a retry is in flight — keeps the button from looking dead. */
  retrying?: boolean;
  className?: string;
}

export default function ReadStatePill({
  state,
  message,
  subject,
  onRetry,
  retryLabel = READ_RETRY_LABEL,
  busyLabel = "Trying…",
  retrying = false,
  className = "",
}: ReadStatePillProps) {
  const tone = TONE[state];
  const copy = message ?? READ_COPY[state];
  const text = subject ? `${subject}: ${copy}` : copy;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="read-state-pill"
      data-read-state={state}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border px-3 py-2 text-xs font-medium leading-5 backdrop-blur-xl ${className}`}
      style={{
        borderColor: `color-mix(in srgb, ${tone.accent} 40%, transparent)`,
        background: `color-mix(in srgb, ${tone.accent} 12%, transparent)`,
        color: "var(--color-text-primary)",
      }}
    >
      <span className="min-w-0">
        {tone.icon && <span aria-hidden="true" className="mr-1">{tone.icon}</span>}
        {text}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying || undefined}
          className="hit-44 tap inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold underline underline-offset-2 disabled:opacity-60"
          style={{ color: "var(--color-text-primary)" }}
        >
          {retrying ? busyLabel : retryLabel}
        </button>
      )}
    </div>
  );
}
