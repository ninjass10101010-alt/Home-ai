"use client";

import { useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import { useGoogleReminders, bucketReminders, type GoogleReminder } from "@/hooks/useGoogleReminders";

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDueShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function ReminderRow({
  reminder,
  onComplete,
}: {
  reminder: GoogleReminder;
  onComplete: (r: GoogleReminder) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[var(--color-surface-0)]/40 p-3 transition hover:bg-[var(--color-surface-0)]/55">
      <button
        type="button"
        onClick={() => onComplete(reminder)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-lg text-[var(--color-accent-selected)] transition active:scale-95 hover:bg-[var(--color-accent-selected)]/25"
        aria-label="Mark done"
      >
        ✓
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{reminder.title}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">⏰ {formatDue(reminder.due)}</p>
      </div>
    </div>
  );
}

function AddReminderInline({ onAdd }: { onAdd: (input: { title: string; due: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const ok = await onAdd({
      title: title.trim(),
      due: new Date(when).toISOString(),
    });
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <SoftButton variant="secondary" size="sm" onClick={() => setOpen(true)} className="w-full">
        + Add reminder
      </SoftButton>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-[var(--color-surface-2)]/50 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Reminder title"
        className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-0)]/60 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent-selected)]"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-0)]/60 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent-selected)]"
      />
      <div className="flex gap-2">
        <SoftButton onClick={submit} loading={submitting} size="sm" className="flex-1">
          Save
        </SoftButton>
        <SoftButton variant="ghost" onClick={() => setOpen(false)} size="sm" className="flex-1">
          Cancel
        </SoftButton>
      </div>
    </div>
  );
}

export default function RemindersSection() {
  const { reminders, loading, error, connected, tasksScopeGranted, notice, refresh, complete, add } =
    useGoogleReminders();
  const [expanded, setExpanded] = useState(true);
  const buckets = bucketReminders(reminders);
  const totalActive = buckets.overdue.length + buckets.today.length + buckets.tomorrow.length + buckets.thisWeek.length + buckets.later.length;

  if (!connected && !loading) {
    return null;
  }

  if (connected && tasksScopeGranted === false) {
    return (
      <SectionCard
        title="Reminders"
        description="Paused — Google Tasks scope not granted"
        icon="⏰"
      >
        <p className="text-xs text-text-muted">
          {notice ||
            "Reminders are backed by Google Tasks. The Tasks API is not in Google's allowed-scopes list for Device Flow, so this connection doesn't include the Tasks scope."}
        </p>
        <p className="mt-2 text-[11px] text-text-muted">
          To enable Reminders, add a <span className="font-mono">https://www.googleapis.com/auth/tasks</span>{" "}
          scope and switch to a Web OAuth client with a public redirect URI (Tailscale Funnel, Cloudflare Tunnel, or
          ngrok). Calendar sync continues to work with your current setup.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Reminders"
      description={connected ? `${totalActive} active · synced from Google` : "Connecting…"}
      icon="⏰"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => refresh()}
            className="grid h-8 w-8 place-items-center rounded-full text-text-secondary transition hover:bg-[var(--color-surface-2)] active:scale-95"
            aria-label="Refresh reminders"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full text-text-secondary transition hover:bg-[var(--color-surface-2)] active:scale-95"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "−" : "+"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {loading && reminders.length === 0 ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : !expanded ? null : totalActive === 0 ? (
        <p className="text-xs text-text-muted">No active reminders. Add one below or create it in Google Tasks.</p>
      ) : (
        <div className="space-y-3">
          {buckets.overdue.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300/90">
                Overdue · {buckets.overdue.length}
              </p>
              <div className="space-y-1.5">
                {buckets.overdue.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onComplete={complete} />
                ))}
              </div>
            </div>
          )}
          {buckets.today.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Today · {buckets.today.length}
              </p>
              <div className="space-y-1.5">
                {buckets.today.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onComplete={complete} />
                ))}
              </div>
            </div>
          )}
          {buckets.tomorrow.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Tomorrow · {buckets.tomorrow.length}
              </p>
              <div className="space-y-1.5">
                {buckets.tomorrow.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onComplete={complete} />
                ))}
              </div>
            </div>
          )}
          {buckets.thisWeek.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                This week · {buckets.thisWeek.length}
              </p>
              <div className="space-y-1.5">
                {buckets.thisWeek.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onComplete={complete} />
                ))}
              </div>
            </div>
          )}
          {buckets.later.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Later · {buckets.later.length}
              </p>
              <div className="space-y-1.5">
                {buckets.later.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onComplete={complete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <AddReminderInline onAdd={add} />
      </div>
    </SectionCard>
  );
}
