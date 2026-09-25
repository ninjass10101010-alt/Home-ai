"use client";

import { useEffect, useRef, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import SoftButton from "@/components/ui/SoftButton";
import { useGoogleConnection, type DisconnectResult } from "@/hooks/useGoogleConnection";

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

interface CalendarSyncEntry {
  ok?: boolean;
  error?: string;
}

interface CalendarSyncPayload {
  events?: number;
  skipped?: boolean;
  reason?: string;
  perCalendar?: CalendarSyncEntry[];
  errors?: Array<{ id?: string; error?: string } | string>;
}

interface CalendarSavePayload {
  ok?: boolean;
  error?: string;
  errors?: Array<{ id?: string; error?: string } | string>;
  pruned?: string[];
}

interface CalendarListPayload {
  ok: true;
  calendars: CalendarOption[];
}

interface SyncStatePayload {
  ok: true;
  calendar_last_sync_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarOption(value: unknown): value is CalendarOption {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.summary === "string"
    && (value.colorRgb === null || typeof value.colorRgb === "string")
    && typeof value.selected === "boolean"
    && (value.lastSyncAt === null || typeof value.lastSyncAt === "string");
}

function isCalendarListPayload(value: unknown): value is CalendarListPayload {
  return isRecord(value)
    && value.ok === true
    && Array.isArray(value.calendars)
    && value.calendars.every(isCalendarOption);
}

function isSyncStatePayload(value: unknown): value is SyncStatePayload {
  return isRecord(value)
    && value.ok === true
    && (value.calendar_last_sync_at === null || typeof value.calendar_last_sync_at === "string");
}

function errorDetail(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "error" in value) {
    const detail = (value as { error?: unknown }).error;
    if (typeof detail === "string") return detail;
  }
  return "unknown error";
}

function countCalendarFailures(payload: { errors?: unknown[]; perCalendar?: CalendarSyncEntry[] }): number {
  const topLevel = Array.isArray(payload.errors) ? payload.errors.length : 0;
  const perCalendar = Array.isArray(payload.perCalendar)
    ? payload.perCalendar.filter((entry) => entry?.ok !== true).length
    : 0;
  return topLevel + perCalendar;
}

function failureLabel(count: number): string {
  return `${count} ${count === 1 ? "calendar" : "calendars"} failed`;
}

function isIssueArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => {
    if (typeof entry === "string") return true;
    if (!entry || typeof entry !== "object") return false;
    const record = entry as { id?: unknown; error?: unknown };
    return (record.id === undefined || typeof record.id === "string")
      && (record.error === undefined || typeof record.error === "string");
  });
}

function isCalendarSavePayload(value: unknown): value is CalendarSavePayload {
  if (!value || typeof value !== "object" || typeof (value as CalendarSavePayload).ok !== "boolean") return false;
  const payload = value as CalendarSavePayload;
  if (payload.ok === false && payload.error === undefined && payload.errors === undefined) return false;
  return (payload.error === undefined || typeof payload.error === "string")
    && (payload.errors === undefined || isIssueArray(payload.errors))
    && (payload.pruned === undefined || (Array.isArray(payload.pruned) && payload.pruned.every((id) => typeof id === "string")));
}

function isCalendarSyncPayload(value: unknown): value is {
  ok: boolean;
  error?: string;
  calendar?: CalendarSyncPayload;
} {
  if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") return false;
  const payload = value as { ok: boolean; error?: unknown; calendar?: unknown; errors?: unknown };
  if (payload.ok === false && payload.error === undefined && payload.errors === undefined) return false;
  if (payload.error !== undefined && typeof payload.error !== "string") return false;
  if (payload.errors !== undefined && !isIssueArray(payload.errors)) return false;
  if (payload.calendar === undefined) return true;
  if (!payload.calendar || typeof payload.calendar !== "object" || Array.isArray(payload.calendar)) return false;
  const calendar = payload.calendar as CalendarSyncPayload;
  if (calendar.events !== undefined && (typeof calendar.events !== "number" || !Number.isFinite(calendar.events))) return false;
  if (calendar.skipped !== undefined && typeof calendar.skipped !== "boolean") return false;
  if (calendar.reason !== undefined && typeof calendar.reason !== "string") return false;
  if (calendar.errors !== undefined && !isIssueArray(calendar.errors)) return false;
  if (calendar.perCalendar !== undefined) {
    if (!Array.isArray(calendar.perCalendar)) return false;
    if (calendar.perCalendar.some((entry) => !entry || typeof entry !== "object" || typeof entry.ok !== "boolean" || (entry.error !== undefined && typeof entry.error !== "string"))) return false;
  }
  return true;
}

function normalizeDisconnectResult(value: unknown): DisconnectResult {
  const invalid: DisconnectResult = {
    outcome: "failed",
    remoteRevoked: false,
    localRevoked: false,
    error: "Disconnect returned an invalid response.",
  };
  if (value === true) {
    return { outcome: "disconnected", remoteRevoked: true, localRevoked: true };
  }
  if (!isRecord(value)
    || typeof value.remoteRevoked !== "boolean"
    || typeof value.localRevoked !== "boolean") {
    return invalid;
  }
  if (value.outcome === "disconnected" && value.remoteRevoked && value.localRevoked) {
    return { outcome: "disconnected", remoteRevoked: true, localRevoked: true };
  }
  if (value.outcome === "local_only"
    && !value.remoteRevoked
    && value.localRevoked
    && typeof value.warning === "string"
    && value.warning.length > 0) {
    return {
      outcome: "local_only",
      remoteRevoked: false,
      localRevoked: true,
      warning: value.warning,
    };
  }
  if (value.outcome === "failed"
    && typeof value.error === "string"
    && value.error.length > 0) {
    return {
      outcome: "failed",
      remoteRevoked: value.remoteRevoked,
      localRevoked: value.localRevoked,
      error: value.error,
    };
  }
  return invalid;
}

function CountdownPill({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const id = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, []);
  const ready = now !== null;
  const remaining = ready ? Math.max(0, expiresAt - now) : 0;
  const mm = String(Math.floor(remaining / 60000)).padStart(1, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  return (
    <span data-google-countdown="true" data-ready={ready} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-2.5 py-1 text-xs font-semibold text-text-secondary">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {ready ? `${mm}:${ss}` : "--:--"}
    </span>
  );
}

export default function GoogleConnectCard() {
  const {
    mounted,
    status,
    statusVersion,
    generation,
    isCurrentGeneration,
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
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState(false);
  const [syncStateError, setSyncStateError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const disconnectStatusRef = useRef<HTMLParagraphElement | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [savingCalendars, setSavingCalendars] = useState(false);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [calendarsReload, setCalendarsReload] = useState(0);
  const calendarMessageTimerRef = useRef<number | null>(null);
  const syncResultTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const noticeFocusTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const syncingRef = useRef(false);
  const disconnectingRef = useRef(false);
  const saveRequestRef = useRef(0);
  const selectionVersionRef = useRef(0);
  const syncRequestRef = useRef(0);
  const disconnectRequestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (calendarMessageTimerRef.current) window.clearTimeout(calendarMessageTimerRef.current);
      if (syncResultTimerRef.current) window.clearTimeout(syncResultTimerRef.current);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (noticeFocusTimerRef.current) window.clearTimeout(noticeFocusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!connectionNotice) return;
    if (noticeFocusTimerRef.current) window.clearTimeout(noticeFocusTimerRef.current);
    noticeFocusTimerRef.current = window.setTimeout(() => disconnectStatusRef.current?.focus(), 0);
    return () => {
      if (noticeFocusTimerRef.current) window.clearTimeout(noticeFocusTimerRef.current);
      noticeFocusTimerRef.current = null;
    };
  }, [connectionNotice]);

  useEffect(() => {
    if (status !== "connected") return;
    const requestGeneration = generation;
    const requestStatusVersion = statusVersion;
    let cancelled = false;
    fetch("/api/google/sync-state", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled || !isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion) return null;
        const data = await res.json().catch(() => null) as unknown;
        if (cancelled || !isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion) return null;
        if (!res.ok || !isSyncStatePayload(data)) throw new Error("invalid sync state");
        return data;
      })
      .then((data) => {
        if (!cancelled && data && isCurrentGeneration(requestGeneration) && statusVersion === requestStatusVersion) {
          setLastSyncAt(data.calendar_last_sync_at);
          setSyncStateError(null);
        }
      })
      .catch(() => {
        if (!cancelled && isCurrentGeneration(requestGeneration) && statusVersion === requestStatusVersion) {
          setLastSyncAt(null);
          setSyncStateError("Couldn't load the last calendar sync time.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generation, isCurrentGeneration, status, statusVersion]);

  useEffect(() => {
    if (status !== "connected") return;
    const requestGeneration = generation;
    const requestStatusVersion = statusVersion;
    let cancelled = false;
    fetch("/api/google/calendars", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled || !isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion) return null;
        const data = await res.json().catch(() => null) as unknown;
        if (cancelled || !isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion) return null;
        if (!res.ok) throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "calendars");
        if (!isCalendarListPayload(data)) throw new Error("invalid calendars");
        return data;
      })
      .then((data) => {
        if (cancelled || !data || !isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion) return;
        setCalendars(data.calendars);
        setCheckedIds(new Set(data.calendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)));
        setCalendarsError(null);
      })
      .catch(() => {
        if (!cancelled && isCurrentGeneration(requestGeneration) && statusVersion === requestStatusVersion) {
          setCalendars(null);
          setCheckedIds(new Set());
          setCalendarsError("Couldn't load your calendars.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [calendarsReload, generation, isCurrentGeneration, status, statusVersion]);

  const selectionDirty = !!calendars && calendars.some((calendar) => calendar.selected !== checkedIds.has(calendar.id));

  const toggleCalendar = (id: string) => {
    selectionVersionRef.current += 1;
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCalendarMsg(null);
    setCalendarError(false);
  };

  const handleSaveCalendars = async () => {
    if (!calendars || savingRef.current) return;
     const requestGeneration = generation;
     const requestStatusVersion = statusVersion;
     const requestId = ++saveRequestRef.current;
     const selectionVersion = selectionVersionRef.current;
     const saveIsCurrent = () =>
       isCurrentGeneration(requestGeneration)
       && statusVersion === requestStatusVersion
       && requestId === saveRequestRef.current
       && selectionVersionRef.current === selectionVersion;
     savingRef.current = true;
    setSavingCalendars(true);
    setCalendarMsg(null);
    setCalendarError(false);
    try {
      const res = await fetch("/api/google/calendars", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendars: calendars.map((calendar) => ({
            id: calendar.id,
            summary: calendar.summary,
            colorRgb: calendar.colorRgb,
            selected: checkedIds.has(calendar.id),
          })),
        }),
      });
      if (!saveIsCurrent()) return;
      const data = await res.json().catch(() => null) as unknown;
      if (!saveIsCurrent()) return;
      if (!isCalendarSavePayload(data)) {
        setCalendarError(true);
        setCalendarMsg("Save failed: Google returned an invalid selection response. Try again.");
        return;
      }
      if (!res.ok || data.ok !== true) {
        const failures = Array.isArray(data?.errors) ? data.errors.length : 0;
        setCalendarError(true);
        setCalendarMsg(
          failures > 0
            ? `${failureLabel(failures)}. Try again.`
            : res.status === 403
              ? "Only a parent can change calendar sync."
              : `Save failed: ${errorDetail(data?.error || res.statusText)}. Try again.`
        );
        return;
      }
      const failures = Array.isArray(data.errors) ? data.errors.length : 0;
      if (failures > 0) {
        setCalendarError(true);
        setCalendarMsg(`${failureLabel(failures)}. Try again.`);
        return;
      }
      setCalendarMsg(data.pruned?.length ? "Saved — removed calendars cleared" : "Saved ✓");
      const refreshed = await fetch("/api/google/calendars", { cache: "no-store" });
      if (!saveIsCurrent()) return;
      const refreshedData = await refreshed.json().catch(() => null) as unknown;
      if (!saveIsCurrent()) return;
      if (!refreshed.ok || !isCalendarListPayload(refreshedData)) {
        setCalendarError(true);
        setCalendarMsg("Saved, but the calendar list could not refresh. Try again.");
        return;
      }
      setCalendars(refreshedData.calendars);
      setCheckedIds(new Set(refreshedData.calendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)));
    } catch (error: unknown) {
      if (saveIsCurrent()) {
        setCalendarError(true);
        setCalendarMsg(`Save failed: ${error instanceof Error ? error.message : "unknown error"}. Try again.`);
      }
    } finally {
      if (requestId === saveRequestRef.current) {
        savingRef.current = false;
        setSavingCalendars(false);
         if (calendarMessageTimerRef.current) window.clearTimeout(calendarMessageTimerRef.current);
         calendarMessageTimerRef.current = window.setTimeout(() => {
           if (saveIsCurrent()) {
             setCalendarMsg(null);
             setCalendarError(false);
           }
         }, 5000);
      }
    }
  };

  const handleCopyCode = async () => {
    if (!waiting) return;
    try {
      await navigator.clipboard.writeText(waiting.user_code);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleConnect = () => {
    setConnectionNotice(null);
    setDisconnectError(null);
    void connect();
  };

  const handleSyncNow = async () => {
    if (syncingRef.current) return;
    const requestGeneration = generation;
    const requestStatusVersion = statusVersion;
    const requestId = ++syncRequestRef.current;
    syncingRef.current = true;
    setSyncing(true);
    setSyncResult(null);
    setSyncError(false);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "calendar" }),
      });
      if (!isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion || requestId !== syncRequestRef.current) return;
      const data = await res.json().catch(() => null) as unknown;
      if (!isCurrentGeneration(requestGeneration) || statusVersion !== requestStatusVersion || requestId !== syncRequestRef.current) return;
      if (!isCalendarSyncPayload(data)) {
        setSyncError(true);
        setSyncResult("Calendar sync failed: Google returned an invalid response. Try again.");
        return;
      }
      if (!res.ok || !data.ok) {
        if (data.calendar?.skipped) {
          setSyncError(true);
          const reason = (data.calendar.reason || "already in progress").replace(/_/g, " ");
          setSyncResult(`Calendar sync skipped: ${reason}. Try again.`);
          return;
        }
        setSyncError(true);
        setSyncResult(`Calendar sync failed: ${errorDetail(data?.error || res.statusText)}. Try again.`);
        return;
      }
      const calendar = data.calendar;
      if (!calendar) {
        setSyncError(true);
        setSyncResult("Calendar sync returned no result. Try again.");
        return;
      }
      if (calendar.skipped) {
        setSyncError(true);
        const reason = (calendar.reason || "already in progress").replace(/_/g, " ");
        setSyncResult(`Calendar sync skipped: ${reason}. Try again.`);
        return;
      }
      const failures = countCalendarFailures(calendar);
      if (failures > 0) {
        setSyncError(true);
        setSyncResult(`Calendar sync incomplete: ${failureLabel(failures)}. Try again.`);
        return;
      }
      if (typeof calendar.events !== "number") {
        setSyncError(true);
        setSyncResult("Calendar sync returned no event count. Try again.");
        return;
      }
      setSyncResult(`Synced ${calendar.events} events`);
      void refresh();
    } catch (error: unknown) {
      if (isCurrentGeneration(requestGeneration) && statusVersion === requestStatusVersion && requestId === syncRequestRef.current) {
        setSyncError(true);
        setSyncResult(`Calendar sync failed: ${error instanceof Error ? error.message : "unknown error"}. Try again.`);
      }
    } finally {
      if (requestId === syncRequestRef.current) {
        syncingRef.current = false;
        setSyncing(false);
        if (syncResultTimerRef.current) window.clearTimeout(syncResultTimerRef.current);
        const resultGeneration = requestGeneration;
        const resultStatusVersion = requestStatusVersion;
        syncResultTimerRef.current = window.setTimeout(() => {
          if (isCurrentGeneration(resultGeneration) && statusVersion === resultStatusVersion && requestId === syncRequestRef.current) {
            setSyncResult(null);
          }
        }, 5000);
      }
    }
  };

  const confirmDisconnect = async () => {
    if (disconnectingRef.current) return;
    const requestId = ++disconnectRequestRef.current;
    disconnectingRef.current = true;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const result = normalizeDisconnectResult(await disconnect());
      if (requestId !== disconnectRequestRef.current) return;
      if (result.outcome === "failed") {
        const detail = result.error || "Disconnect failed";
        setDisconnectError(
          detail.includes("Google Calendar")
            ? detail
            : `Couldn't disconnect Google Calendar. ${detail}`,
        );
        return;
      }
      setDisconnectOpen(false);
      setCalendars(null);
      setCheckedIds(new Set());
      setConnectionNotice(
        result.outcome === "local_only"
          ? "Disconnected from the family server. Google access may remain remotely."
          : "Disconnected from Google Calendar."
      );
    } catch (error: unknown) {
      if (requestId === disconnectRequestRef.current) {
        setDisconnectError(error instanceof Error ? error.message : "Couldn't disconnect Google Calendar. Try again.");
      }
    } finally {
      if (requestId === disconnectRequestRef.current) {
        disconnectingRef.current = false;
        setDisconnecting(false);
      }
    }
  };

  const content = !mounted ? (
    <div className="space-y-3" aria-busy="true">
      <div className="h-10 w-40 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
      <div className="h-4 w-72 animate-pulse rounded bg-[var(--color-surface-2)]" />
    </div>
  ) : status === "connected" && state ? (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-mint)]/20 text-xl" aria-hidden="true">✓</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Connected as {state.account_email || "Google account"}</p>
          <p className="mt-0.5 text-xs text-text-secondary">Google Calendar sync is on for this family server.</p>
          {state.minutes_until_expiry !== null ? (
            <p className="mt-1 text-[11px] text-text-muted">Access expires in {state.minutes_until_expiry} min · Last granted {formatRelativeTime(state.granted_at)}</p>
          ) : null}
          {lastSyncAt ? <p className="mt-1 text-[11px] text-text-muted">Last auto-sync: {formatRelativeTime(lastSyncAt)}</p> : null}
          {syncStateError ? <p role="status" className="mt-1 text-[11px] text-text-secondary">{syncStateError}</p> : null}
        </div>
      </div>
      {calendars && calendars.length > 0 ? (
        <div className="space-y-2 border-y border-white/10 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-text-muted">Calendars</p>
          <p className="text-xs text-text-secondary">Choose which Google calendars Consuela syncs.</p>
          <div className="mt-3 space-y-1">
            {calendars.map((calendar) => (
              <label key={calendar.id} className="tap-sm flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-white/5">
                 <input
                   type="checkbox"
                   checked={checkedIds.has(calendar.id)}
                   disabled={savingCalendars}
                   onChange={() => toggleCalendar(calendar.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent-selected)]"
                  aria-label={`Sync ${calendar.summary}`}
                />
                <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ background: calendar.colorRgb || "var(--color-accent-cyan)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{calendar.summary}</span>
                  <span className="block text-[11px] text-text-muted">Last synced {formatRelativeTime(calendar.lastSyncAt)}</span>
                </span>
              </label>
            ))}
          </div>
          {calendarMsg ? <p className={`mt-2 text-xs ${calendarError ? "font-semibold text-[var(--color-accent-rose)]" : "text-text-secondary"}`} role={calendarError ? "alert" : "status"}>{calendarMsg}</p> : null}
          <SoftButton onClick={handleSaveCalendars} loading={savingCalendars} disabled={!selectionDirty || savingCalendars} className="mt-3 w-full">Save calendars</SoftButton>
        </div>
      ) : null}
      {calendarsError ? (
        <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs text-text-secondary" role="status">
          {calendarsError} <button type="button" onClick={() => { setCalendarsError(null); setCalendarsReload((value) => value + 1); }} className="font-semibold text-text-primary underline underline-offset-2">Try again</button>
        </div>
      ) : null}
      {syncResult ? <div className={`rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs ${syncError ? "font-semibold text-[var(--color-accent-rose)]" : "text-text-secondary"}`} role={syncError ? "alert" : "status"}>{syncResult}</div> : null}
      <div className="flex gap-2">
        <SoftButton onClick={handleSyncNow} loading={syncing} className="flex-1">Sync now</SoftButton>
        <SoftButton variant="secondary" onClick={() => { setDisconnectError(null); setDisconnectOpen(true); }} disabled={disconnecting} className="flex-1">Disconnect</SoftButton>
      </div>
    </div>
  ) : status === "waiting" && waiting ? (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 animate-pulse place-items-center rounded-2xl bg-[var(--color-accent-selected)]/20 text-xl" aria-hidden="true">🔗</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Waiting for Google sign-in</p>
          <p className="mt-0.5 text-xs text-text-secondary">On any device, open the URL below and enter this code:</p>
        </div>
        <CountdownPill expiresAt={waiting.expires_at} />
      </div>
      <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/40 p-5 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Your code</p>
        <p className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.2em] text-text-primary">{waiting.user_code}</p>
        <p className="mt-3 select-all break-all text-xs text-text-secondary">{waiting.verification_url}</p>
      </div>
      <div className="flex gap-2">
        <SoftButton onClick={handleCopyCode} className="flex-1">{copied ? "Copied!" : "Copy code"}</SoftButton>
        <SoftButton variant="secondary" onClick={() => window.open(waiting.verification_url, "_blank", "noopener,noreferrer")} className="flex-1">Open google.com/device</SoftButton>
      </div>
      <SoftButton variant="ghost" onClick={cancel} className="w-full">Cancel</SoftButton>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-xl" aria-hidden="true">🔗</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            {status === "error:config" ? "Google credentials not configured" : status === "error:revoked" ? "Previously connected — please reconnect" : "Connect a Google account"}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">Sync your family calendar with Consuela. Google sign-in opens on any device using a one-time code — no browser redirect required.</p>
        </div>
      </div>
      {errorMessage ? <p role="alert" className="rounded-xl border border-[var(--color-accent-rose)]/30 bg-[var(--color-accent-rose)]/10 px-3 py-2 text-xs text-[var(--color-accent-rose)]">{errorMessage}</p> : null}
      <SoftButton onClick={handleConnect} className="w-full">{status === "error:revoked" ? "Reconnect" : "Connect Google account"}</SoftButton>
    </div>
  );

  return (
    <>
      <SectionCard
        title="Google Calendar"
        description="Sync family calendar events to Consuela."
        icon="📅"
        tone="var(--color-accent-cyan)"
        className="settings-google-card"
      >
        {connectionNotice ? <p ref={disconnectStatusRef} data-google-disconnect-status="true" tabIndex={-1} role="status" className="mb-3 text-sm font-semibold text-[var(--color-accent-amber)]">{connectionNotice}</p> : null}
        {content}
      </SectionCard>
      <SettingsConfirmDialog
        open={disconnectOpen}
        title="Disconnect Google Calendar?"
        description="Consuela will stop syncing calendar events. You can reconnect the account at any time."
        confirmLabel="Disconnect Google"
        busy={disconnecting}
        onConfirm={() => {
          void confirmDisconnect();
        }}
        onClose={() => {
          if (!disconnecting) setDisconnectOpen(false);
        }}
        body={<p className="text-sm leading-6 text-text-secondary">Other family data and settings are not changed.</p>}
        error={disconnectError}
      />
    </>
  );
}
