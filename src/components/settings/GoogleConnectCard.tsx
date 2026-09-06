/* eslint-disable react-hooks/purity, react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import SoftButton from "@/components/ui/SoftButton";
import { useGoogleConnection } from "@/hooks/useGoogleConnection";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

interface CalendarOption {
  id: string;
  summary: string;
  colorRgb: string | null;
  selected: boolean;
  lastSyncAt: string | null;
}

function CountdownPill({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, expiresAt - now);
  const mm = String(Math.floor(remaining / 60000)).padStart(1, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-2.5 py-1 text-xs font-semibold text-text-secondary">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {mm}:{ss}
    </span>
  );
}

export default function GoogleConnectCard() {
  const {
    mounted,
    status,
    state,
    waiting,
    errorMessage,
    connect,
    disconnect,
    cancel,
    refresh,
  } = useGoogleConnection();

  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Multi-calendar selection (Fix-C): the Google calendarList merged with the
  // saved selection, editable via checkboxes + Save (PUT /api/google/calendars).
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [savingCalendars, setSavingCalendars] = useState(false);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [calendarsReload, setCalendarsReload] = useState(0);

  useEffect(() => {
    if (status !== "connected") return;
    fetch("/api/google/sync-state")
      .then((r) => r.json())
      .then((d) => setLastSyncAt(d.calendar_last_sync_at || d.tasks_last_sync_at))
      .catch(() => {});
  }, [status]);

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    setCalendarsError(null);
    fetch("/api/google/calendars")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.ok === false) {
          setCalendars(null);
          setCalendarsError(d.error || "Couldn't load your calendars.");
          return;
        }
        const list: CalendarOption[] = Array.isArray(d?.calendars) ? d.calendars : [];
        setCalendars(list);
        setCheckedIds(new Set(list.filter((c) => c.selected).map((c) => c.id)));
      })
      .catch(() => {
        if (!cancelled) setCalendarsError("Couldn't load your calendars.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, calendarsReload]);

  const selectionDirty = !!calendars && calendars.some((c) => c.selected !== checkedIds.has(c.id));

  const toggleCalendar = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCalendarMsg(null);
  };

  const handleSaveCalendars = async () => {
    if (!calendars) return;
    setSavingCalendars(true);
    setCalendarMsg(null);
    try {
      const res = await fetch("/api/google/calendars", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendars: calendars.map((c) => ({
            id: c.id,
            summary: c.summary,
            colorRgb: c.colorRgb,
            selected: checkedIds.has(c.id),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCalendarMsg(
          res.status === 403
            ? "Only grown-ups can change calendar sync."
            : `Save failed: ${data?.error || res.statusText}`,
        );
      } else {
        setCalendarMsg(data?.pruned?.length ? "Saved — removed calendars cleared" : "Saved ✓");
        // Re-read the merged selection (newly selected calendars appear with
        // their real state; last-synced lines refresh).
        fetch("/api/google/calendars")
          .then((r) => r.json())
          .then((d) => {
            const list: CalendarOption[] = Array.isArray(d?.calendars) ? d.calendars : [];
            setCalendars(list);
            setCheckedIds(new Set(list.filter((c) => c.selected).map((c) => c.id)));
          })
          .catch(() => {});
      }
    } catch (e: any) {
      setCalendarMsg(`Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingCalendars(false);
      setTimeout(() => setCalendarMsg(null), 5000);
    }
  };

  if (!mounted) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        <div className="h-4 w-72 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    );
  }

  const handleCopyCode = async () => {
    if (!waiting) return;
    try {
      await navigator.clipboard.writeText(waiting.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncResult(`Sync failed: ${data?.error || res.statusText}`);
      } else {
        const parts: string[] = [];
        if (data.calendar) parts.push(`📅 ${data.calendar.events} events`);
        if (data.tasks) parts.push(`✅ ${data.tasks.tasks} tasks`);
        setSyncResult(parts.length ? `Synced ${parts.join(" · ")}` : "Up to date");
        refresh();
      }
    } catch (e: any) {
      setSyncResult(`Sync failed: ${e?.message || "unknown error"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  };

  if (status === "connected" && state) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/20 text-xl">
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">
              Connected as {state.account_email || "Google account"}
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              {state.scope
                ? `Granted: ${state.scope.split(" ").filter((s) => s.includes("googleapis")).map((s) => s.split("/").pop()).join(", ")}`
                : "Calendar + Tasks access granted"}
            </p>
            {state.minutes_until_expiry !== null && (
              <p className="mt-1 text-[11px] text-text-muted">
                Access token expires in {state.minutes_until_expiry} min · Last granted {formatRelativeTime(state.granted_at)}
              </p>
            )}
            {lastSyncAt && (
              <p className="mt-1 text-[11px] text-text-muted">
                Last auto-sync: {formatRelativeTime(lastSyncAt)}
              </p>
            )}
          </div>
        </div>
        {calendars && calendars.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-text-muted">
              Calendars
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Choose which Google calendars Consuela syncs.
            </p>
            <div className="mt-3 space-y-1.5">
              {calendars.map((c) => (
                <label
                  key={c.id}
                  className="tap-sm flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(c.id)}
                    onChange={() => toggleCalendar(c.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent-selected)]"
                    aria-label={`Sync ${c.summary}`}
                  />
                  <span
                    aria-hidden
                    className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-white/20"
                    style={{ background: c.colorRgb || "var(--color-accent-cyan)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {c.summary}
                    </span>
                    <span className="block text-[11px] text-text-muted">
                      Last synced {formatRelativeTime(c.lastSyncAt)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {calendarMsg && (
              <p className="mt-2 text-xs text-text-secondary" role="status">
                {calendarMsg}
              </p>
            )}
            <SoftButton
              onClick={handleSaveCalendars}
              loading={savingCalendars}
              disabled={!selectionDirty || savingCalendars}
              className="mt-3 w-full"
            >
              Save calendars
            </SoftButton>
          </div>
        )}
        {calendarsError && (
          <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs text-text-secondary" role="status">
            {calendarsError}{" "}
            <button
              type="button"
              onClick={() => setCalendarsReload((n) => n + 1)}
              className="font-semibold text-text-primary underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}
        {syncResult && (
          <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs text-text-secondary">
            {syncResult}
          </div>
        )}
        <div className="flex gap-2">
          <SoftButton onClick={handleSyncNow} loading={syncing} className="flex-1">
            Sync now (every 5 min)
          </SoftButton>
          <SoftButton variant="secondary" onClick={() => disconnect()} className="flex-1">
            Disconnect
          </SoftButton>
        </div>
      </div>
    );
  }

  if (status === "waiting" && waiting) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 animate-pulse place-items-center rounded-2xl bg-[var(--color-accent-selected)]/20 text-xl">
            🔗
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">
              Waiting for Google sign-in
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              On any device, open the URL below and enter this code:
            </p>
          </div>
          <CountdownPill expiresAt={waiting.expires_at} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/40 p-5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Your code
          </p>
          <p className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.2em] text-text-primary">
            {waiting.user_code}
          </p>
          <p className="mt-3 select-all break-all text-xs text-text-secondary">
            {waiting.verification_url}
          </p>
        </div>
        <div className="flex gap-2">
          <SoftButton onClick={handleCopyCode} className="flex-1">
            {copied ? "Copied!" : "Copy code"}
          </SoftButton>
          <SoftButton
            variant="secondary"
            onClick={() => window.open(waiting.verification_url, "_blank", "noopener,noreferrer")}
            className="flex-1"
          >
            Open google.com/device
          </SoftButton>
        </div>
        <SoftButton variant="ghost" onClick={cancel} className="w-full">
          Cancel
        </SoftButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-xl">
          🔗
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            {status === "error:config"
              ? "Google credentials not configured"
              : status === "error:revoked"
                ? "Previously connected — please reconnect"
                : "Connect a Google account"}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Two-way sync for the Calendar and Tasks tabs. Google sign-in opens on any device
            using a one-time code — no browser redirect required.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}

      <SoftButton onClick={connect} className="w-full">
        {status === "error:revoked" ? "Reconnect" : "Connect Google account"}
      </SoftButton>
    </div>
  );
}
