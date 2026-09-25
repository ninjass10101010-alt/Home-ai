"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import Toggle from "@/components/ui/Toggle";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";

interface NotifyTarget {
  target: string;
  enabled: boolean;
  channel?: "ha" | "telegram";
  available?: boolean;
}

interface NotifyTargetsPayload {
  ok: true;
  targets: NotifyTarget[];
  telegramAvailable: boolean;
  warning?: string;
}

type Prefs = { briefing: boolean; weather: boolean; calendar: boolean };

const PREF_ROWS: Array<{ key: keyof Prefs; label: string; hint: string }> = [
  { key: "briefing", label: "Morning briefing", hint: "The 7am digest of your day." },
  { key: "weather", label: "Severe weather", hint: "Storms and big snow — pushed once per episode." },
  { key: "calendar", label: "Important calendar events", hint: "A heads-up about an hour before an important event." },
];

function friendlyLabel(target: string): string {
  const cleaned = target.replace(/^notify\./, "").replace(/^mobile_app_/, "");
  return cleaned
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isTelegramTarget(row: NotifyTarget): boolean {
  return row.channel === "telegram" || row.target === "telegram" || row.target === "notify.telegram";
}

function isNotifyTarget(value: unknown): value is NotifyTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.target === "string"
    && row.target.trim().length > 0
    && typeof row.enabled === "boolean"
    && (row.channel === undefined || row.channel === "ha" || row.channel === "telegram")
    && (row.available === undefined || typeof row.available === "boolean");
}

function isNotifyTargetsPayload(value: unknown): value is NotifyTargetsPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.ok === true
    && typeof payload.telegramAvailable === "boolean"
    && Array.isArray(payload.targets)
    && payload.targets.every(isNotifyTarget)
    && (payload.warning === undefined || typeof payload.warning === "string");
}

function isCompletePrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.briefing === "boolean"
    && typeof record.weather === "boolean"
    && typeof record.calendar === "boolean";
}

export default function HaNotificationsCard() {
  const [payload, setPayload] = useState<NotifyTargetsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [testedTarget, setTestedTarget] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ briefing: false, weather: false, calendar: false });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [busyPref, setBusyPref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefsWriteStartedRef = useRef(false);
  const prefsLoadGenerationRef = useRef(0);
  const prefsWriteVersionRef = useRef(0);
  const targetBusyRef = useRef(false);
  const prefBusyRef = useRef(false);

  const load = useCallback(async () => {
    const loadGeneration = ++prefsLoadGenerationRef.current;
    const writeVersionAtStart = prefsWriteVersionRef.current;
    setPrefsBusy(true);
    setPrefsLoaded(false);
    setError(null);
    try {
      const res = await fetch("/api/ha/notify-targets");
      if (loadGeneration !== prefsLoadGenerationRef.current) return;
      const data = await res.json().catch(() => null) as unknown;
      if (loadGeneration !== prefsLoadGenerationRef.current) return;
      if (!res.ok || !isNotifyTargetsPayload(data)) {
        setPayload(null);
        setLoadFailed(true);
        return;
      }
      setPayload(data);
      setLoadFailed(false);
      try {
        const prefRes = await fetch("/api/ha/notify-prefs");
        if (loadGeneration !== prefsLoadGenerationRef.current) return;
        const prefData = (await prefRes.json().catch(() => null)) as { ok?: boolean; prefs?: unknown } | null;
        if (loadGeneration !== prefsLoadGenerationRef.current) return;
        if (!prefRes.ok || prefData?.ok !== true || !isCompletePrefs(prefData.prefs)) {
          throw new Error("invalid preferences");
        }
        if (prefsWriteStartedRef.current || prefsWriteVersionRef.current !== writeVersionAtStart) {
          setPrefsLoaded(true);
          return;
        }
        setPrefs(prefData.prefs);
        setPrefsLoaded(true);
        setError(null);
      } catch {
        if (loadGeneration !== prefsLoadGenerationRef.current) return;
        setPrefsLoaded(false);
        setError("Couldn't load the alert preferences. Try again.");
      }
    } catch {
      if (loadGeneration === prefsLoadGenerationRef.current) setLoadFailed(true);
    } finally {
      if (loadGeneration === prefsLoadGenerationRef.current) setPrefsBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      prefsLoadGenerationRef.current += 1;
    };
  }, [load]);

  const serverRows = Array.isArray(payload?.targets) ? payload.targets : [];
  const hasTelegramRow = serverRows.some(isTelegramTarget);
  const telegramAvailable = payload?.telegramAvailable === true;
  const rows: NotifyTarget[] = telegramAvailable || hasTelegramRow
    ? [
        ...serverRows.filter((row) => !isTelegramTarget(row)),
        { target: "telegram", enabled: true, channel: "telegram", available: telegramAvailable },
      ]
    : [...serverRows];
  const prefsReady = prefsLoaded && !prefsBusy && !error?.startsWith("Couldn't load the alert preferences");

  const setEnabled = async (row: NotifyTarget, enabled: boolean) => {
    if (targetBusyRef.current || !prefsReady || row.channel === "telegram") return;
    targetBusyRef.current = true;
    const previous = row.enabled;
    setBusyTarget(row.target);
    setError(null);
    setPayload((current) => current ? {
      ...current,
      targets: (current.targets ?? []).map((target) => target.target === row.target ? { ...target, enabled } : target),
    } : current);
    try {
      const res = await fetch("/api/ha/notify-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: row.target, enabled }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok !== true) throw new Error("notify target save failed");
    } catch {
      setPayload((current) => current ? {
        ...current,
        targets: (current.targets ?? []).map((target) => target.target === row.target ? { ...target, enabled: previous } : target),
      } : current);
      setError(`Couldn't update ${friendlyLabel(row.target)}. Try again.`);
    } finally {
      targetBusyRef.current = false;
      setBusyTarget(null);
    }
  };

  const sendTest = async (row: NotifyTarget) => {
    if (targetBusyRef.current || !prefsReady || (row.channel === "telegram" && row.available === false)) return;
    targetBusyRef.current = true;
    setBusyTarget(row.target);
    setTestedTarget(null);
    setError(null);
    try {
      const res = await fetch("/api/ha/notify-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.channel === "telegram" ? { channel: "telegram" } : { target: row.target }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok !== true) throw new Error("test notification failed");
      setTestedTarget(row.target);
    } catch {
      setError(`Couldn't send a test to ${friendlyLabel(row.target)}. Try again.`);
    } finally {
      targetBusyRef.current = false;
      setBusyTarget(null);
    }
  };

  const setPref = async (key: keyof Prefs, enabled: boolean) => {
    if (prefBusyRef.current || !prefsReady) return;
    const previous = prefs[key];
    const label = PREF_ROWS.find((row) => row.key === key)?.label || key;
    prefsWriteStartedRef.current = true;
    const writeVersion = ++prefsWriteVersionRef.current;
    prefBusyRef.current = true;
    setBusyPref(key);
    setError(null);
    setPrefs((current) => ({ ...current, [key]: enabled }));
    try {
      const res = await fetch("/api/ha/notify-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok !== true) throw new Error("preference save failed");
    } catch {
      setPrefs((current) => ({ ...current, [key]: previous }));
      setError(`Couldn't update ${label}. Try again.`);
    } finally {
      if (writeVersion === prefsWriteVersionRef.current) {
        prefsWriteStartedRef.current = false;
        prefBusyRef.current = false;
        setBusyPref(null);
      }
    }
  };

  return (
    <SectionCard
      title="Notifications"
      description="Choose which phones and the family Telegram chat receive house alerts."
      icon="🔔"
      tone="var(--color-accent-amber)"
    >
      {loadFailed ? (
        <p className="text-sm text-text-secondary">Home Assistant notifications are unavailable right now — check the House connection.</p>
      ) : !payload ? (
        <p className="text-sm text-text-secondary">Loading notification targets…</p>
      ) : (
        <>
          {error ? <p role="alert" className="mb-3 text-sm font-semibold text-[var(--color-accent-rose)]">{error}</p> : null}
          {!prefsReady && !prefsBusy ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 px-3 py-2 text-xs text-[var(--color-accent-rose)]">
              <span>Alert preferences are unavailable.</span>
              <SoftButton size="sm" variant="secondary" onClick={() => { void load(); }}>Try again</SoftButton>
            </div>
          ) : null}
          <div className="space-y-2" data-ha-prefs-loaded={prefsLoaded} data-ha-prefs-busy={prefsBusy}>
            {rows.map((row) => (
              <div
                key={row.target}
                data-ha-telegram-row={row.channel === "telegram" ? "true" : undefined}
                className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-3"
              >
                {row.channel === "telegram" ? (
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">Telegram</p>
                    <p className="mt-1 text-xs text-text-muted">{row.available === false ? "Telegram unavailable" : "Family chat · Always on"}</p>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <Toggle
                      checked={row.enabled}
                      disabled={!prefsReady || busyTarget === row.target}
                      onCheckedChange={(checked) => {
                        void setEnabled(row, checked);
                      }}
                      label={friendlyLabel(row.target)}
                    />
                  </div>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {testedTarget === row.target ? <Chip size="sm" tone="success">Sent ✓</Chip> : null}
                  {row.channel !== "telegram" || row.available !== false ? (
                    <SoftButton
                      size="sm"
                      variant="secondary"
                      className="tap-sm"
                      disabled={!prefsReady || busyTarget === row.target}
                      onClick={() => {
                        void sendTest(row);
                      }}
                      aria-label={`Send test notification to ${friendlyLabel(row.target)}`}
                    >
                      Test
                    </SoftButton>
                  ) : null}
                </div>
              </div>
            ))}
            {rows.length === 0 ? (
              <p className="text-sm text-text-secondary">No HA companion devices found yet — install the Home Assistant app on a phone and it will appear here.</p>
            ) : null}
            {payload.warning ? <p className="pt-1 text-xs text-text-muted">{payload.warning}</p> : null}
          </div>

          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">What to send</p>
            {PREF_ROWS.map((row) => (
              <div key={row.key} className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-3">
                <Toggle
                  checked={prefs[row.key]}
                  disabled={!prefsReady || busyPref === row.key}
                  onCheckedChange={(checked) => {
                    void setPref(row.key, checked);
                  }}
                  label={row.label}
                />
                <p className="mt-1 text-xs text-text-muted">{row.hint}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}
