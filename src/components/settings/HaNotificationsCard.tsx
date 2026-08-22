"use client";

import { useCallback, useEffect, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import Toggle from "@/components/ui/Toggle";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";

interface NotifyTarget {
  target: string;
  enabled: boolean;
  channel?: "ha" | "telegram";
}

interface NotifyTargetsPayload {
  ok?: boolean;
  targets?: NotifyTarget[];
  telegramAvailable?: boolean;
  warning?: string;
}

function friendlyLabel(target: string): string {
  const cleaned = target.replace(/^notify\./, "").replace(/^mobile_app_/, "");
  return cleaned
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Settings → Notifications: pick which phones (HA companion targets) and the
 * family Telegram chat receive house alerts and the morning briefing digest. */
export default function HaNotificationsCard() {
  const [payload, setPayload] = useState<NotifyTargetsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [testedTarget, setTestedTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ha/notify-targets");
      const data = (await res.json().catch(() => null)) as NotifyTargetsPayload | null;
      if (!res.ok || !data || data.ok !== true) {
        setLoadFailed(true);
        return;
      }
      setPayload(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows: NotifyTarget[] = payload?.targets ?? [];
  if (payload?.telegramAvailable) {
    rows.push({ target: "telegram", enabled: false, channel: "telegram" });
  }

  const setEnabled = async (row: NotifyTarget, enabled: boolean) => {
    setBusyTarget(row.target);
    try {
      await fetch("/api/ha/notify-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: row.target, enabled }),
      });
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              targets: (prev.targets ?? []).map((t) =>
                t.target === row.target ? { ...t, enabled } : t
              ),
            }
          : prev
      );
    } finally {
      setBusyTarget(null);
    }
  };

  const sendTest = async (row: NotifyTarget) => {
    setBusyTarget(row.target);
    setTestedTarget(null);
    try {
      const res = await fetch("/api/ha/notify-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          row.channel === "telegram" ? { channel: "telegram" } : { target: row.target }
        ),
      });
      if (res.ok) setTestedTarget(row.target);
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <SectionCard
      title="Notifications"
      description="Choose which phones and the family Telegram chat receive house alerts."
      icon="🔔"
      tone="#f59e0b"
    >
      {loadFailed ? (
        <p className="text-sm text-text-secondary">
          Home Assistant notifications are unavailable right now — check the House connection.
        </p>
      ) : !payload ? (
        <p className="text-sm text-text-secondary">Loading notification targets…</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.target}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Toggle
                  checked={row.enabled}
                  disabled={busyTarget === row.target}
                  onCheckedChange={(checked) => setEnabled(row, checked)}
                  label={`${friendlyLabel(row.target)}${row.channel === "telegram" ? " (Telegram)" : ""}`}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {testedTarget === row.target && <Chip size="sm" tone="success">Sent ✓</Chip>}
                <SoftButton
                  size="sm"
                  variant="secondary"
                  className="tap-sm"
                  disabled={busyTarget === row.target}
                  onClick={() => sendTest(row)}
                  aria-label={`Send test notification to ${friendlyLabel(row.target)}`}
                >
                  Test
                </SoftButton>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-text-secondary">
              No HA companion devices found yet — install the Home Assistant app on a phone and it will appear here.
            </p>
          )}
          {payload.warning && (
            <p className="pt-1 text-xs text-text-muted">{payload.warning}</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
