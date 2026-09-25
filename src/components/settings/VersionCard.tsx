"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import SoftButton from "@/components/ui/SoftButton";

interface VersionInfo {
  hash: string;
  short: string;
  message: string;
  date: string;
  author: string;
}

interface VersionData {
  ok: boolean;
  error?: string;
  status?: number;
  built_at?: VersionInfo;
  latest_remote?: VersionInfo | null;
  update_available?: boolean;
  commits_behind?: number;
}

interface UpdateLog {
  step: string;
  status: "ok" | "error" | "running";
  detail: string;
  timestamp: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUpdateLog(value: unknown): value is UpdateLog {
  if (!isRecord(value)) return false;
  return typeof value.step === "string"
    && value.step.length > 0
    && (value.status === "ok" || value.status === "error" || value.status === "running")
    && typeof value.detail === "string"
    && typeof value.timestamp === "string"
    && Number.isFinite(Date.parse(value.timestamp));
}

function isUpdateLogArray(value: unknown): value is UpdateLog[] {
  return Array.isArray(value) && value.every(isUpdateLog);
}

function isVersionInfo(value: unknown): value is VersionInfo {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.hash === "string"
    && typeof record.short === "string"
    && typeof record.message === "string"
    && typeof record.date === "string";
}

function versionErrorMessage(data: { error?: string } | null, status: number): string {
  if (data?.error === "adult_only") return "Adults only — sign in as a parent to check dashboard updates.";
  if (status === 401) return "Sign in as a parent to check dashboard updates.";
  return "Couldn't reach the update service — check your connection and try again.";
}

export default function VersionCard() {
  const [data, setData] = useState<VersionData | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<UpdateLog[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const updateGuardRef = useRef(false);
  const reloadTimerRef = useRef<number | null>(null);

  const readVersion = useCallback(async () => {
    const res = await fetch("/api/admin/version", { cache: "no-store" });
    const body = await res.json().catch(() => null) as VersionData | null;
    if (!res.ok || !body || body.ok !== true) {
      setData({ ok: false, error: body?.error || `status ${res.status}`, status: res.status });
      return;
    }
    setData(body);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void readVersion().catch(() => setData({ ok: false }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [readVersion]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      await readVersion();
    } catch {
      setData({ ok: false });
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async () => {
    if (updateGuardRef.current || updating || updateDone) return;
    updateGuardRef.current = true;
    setUpdating(true);
    setUpdateLogs([]);
    setUpdateDone(false);
    setUpdateError(null);
    try {
      const res = await fetch("/api/admin/update", { method: "POST" });
      const result = await res.json().catch(() => null) as unknown;
      if (!res.ok || !isRecord(result) || result.ok !== true) {
        const detail = isRecord(result) && result.error === "adult_only"
          ? "Adults only — sign in as a parent to update the dashboard."
          : isRecord(result) && typeof result.error === "string"
            ? result.error
            : `Update failed (${res.status})`;
        const logs = isRecord(result) && isUpdateLogArray(result.logs) ? result.logs : [];
        setUpdateLogs(logs.length > 0 ? logs : [{ step: "error", status: "error", detail, timestamp: new Date().toISOString() }]);
        setUpdateError(detail);
        return;
      }
      if (!isUpdateLogArray(result.logs)) {
        const detail = "Update returned an invalid update progress response. Check the dashboard before retrying.";
        setUpdateLogs([{ step: "error", status: "error", detail, timestamp: new Date().toISOString() }]);
        setUpdateError(detail);
        return;
      }
      setUpdateLogs(result.logs);
      setUpdateDone(true);
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => window.location.reload(), 8000);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Update failed — try again.";
      setUpdateLogs([{ step: "error", status: "error", detail, timestamp: new Date().toISOString() }]);
      setUpdateError(detail);
    } finally {
      updateGuardRef.current = false;
      setUpdating(false);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center gap-3" aria-busy="true">
        <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    );
  }

  if (!data.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{versionErrorMessage(data, data.status ?? 0)}</p>
        <SoftButton onClick={checkNow} loading={checking} size="sm">Try again</SoftButton>
      </div>
    );
  }

  const built = data.built_at || { hash: "", short: "unknown", message: "—", date: "", author: "" };
  const remote = isVersionInfo(data.latest_remote) ? data.latest_remote : null;
  const localKnown = isVersionInfo(data.built_at)
    && data.built_at.hash.trim() !== ""
    && data.built_at.hash !== "unknown";

  if (!localKnown) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-text-primary">Local version unknown</p>
        <p role="status" className="text-sm text-text-secondary">Couldn&apos;t verify the installed dashboard version. Try again.</p>
        <SoftButton onClick={checkNow} loading={checking} size="sm">Try again</SoftButton>
      </div>
    );
  }

  if (!remote) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {built.short && built.short !== "unknown" ? `Consuela Dashboard ${built.short}` : "Development build"}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{built.message || "—"}</p>
        </div>
        <p role="status" className="text-sm text-text-secondary">Couldn&apos;t check for updates. Try again when the family server is reachable.</p>
        <SoftButton onClick={checkNow} loading={checking} size="sm">Try again</SoftButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {built.short && built.short !== "unknown" ? `Consuela Dashboard ${built.short}` : "Development build"}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{built.message || "—"}</p>
          {built.date ? (
            <p className="text-[10px] text-text-muted">
              Built {new Date(built.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          ) : null}
        </div>
        {data.update_available ? (
          <span className="shrink-0 rounded-full bg-[var(--color-accent-amber)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--color-accent-amber)]">{data.commits_behind ?? 0} behind</span>
        ) : (
          <span className="shrink-0 rounded-full bg-[var(--color-accent-mint)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--color-accent-mint)]">Up to date</span>
        )}
      </div>

      {remote && data.update_available ? (
        <div className="rounded-xl border border-[var(--color-accent-amber)]/20 bg-[var(--color-accent-amber)]/5 px-3 py-2">
          <p className="text-[11px] font-semibold text-[var(--color-accent-amber)]">Latest: {remote.short} — {remote.message || "—"}</p>
          <p className="mt-1 text-[10px] text-text-muted">Run <span className="font-mono text-text-secondary">bash deploy.sh</span> on the family server or rebuild the container to update.</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        <SoftButton onClick={checkNow} loading={checking} size="sm" className="flex-1">Check for updates</SoftButton>
        {data.update_available && remote ? (
          <SoftButton
            variant="secondary"
            size="sm"
            onClick={() => {
              localStorage.setItem("consuela-last-version-hash", remote.hash || "");
              window.open(`https://github.com/ninjass10101010-alt/Home-ai/compare/${built.hash}...${remote.hash}`, "_blank", "noopener,noreferrer");
            }}
            className="flex-1"
          >
            View changes
          </SoftButton>
        ) : null}
      </div>

      {data.update_available ? (
        <SoftButton onClick={() => setUpdateOpen(true)} loading={updating} disabled={updateDone} variant="success" className="w-full">
          {updateDone ? "Done — reloading..." : "Update now (self-update)"}
        </SoftButton>
      ) : null}

      {updateError ? <p role="alert" className="text-sm font-semibold text-[var(--color-accent-rose)]">{updateError}</p> : null}

      {updateLogs.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 p-3">
          <p className="mb-2 text-[11px] font-semibold text-text-muted">Update progress:</p>
          <div className="space-y-1">
            {updateLogs.map((log, index) => (
              <div key={`${log.step}-${index}`} className={`flex items-start gap-2 text-[11px] ${log.status === "error" ? "text-[var(--color-accent-rose)]" : log.status === "ok" ? "text-[var(--color-accent-mint)]" : "text-text-muted"}`}>
                <span className="shrink-0">{log.status === "ok" ? "✓" : log.status === "error" ? "✗" : "○"}</span>
                <span>{log.detail}</span>
              </div>
            ))}
          </div>
          {updateDone ? <p className="mt-2 text-[11px] font-semibold text-[var(--color-accent-mint)]">Update complete — the page will reload in a few seconds.</p> : null}
        </div>
      ) : null}

      <SettingsConfirmDialog
        open={updateOpen}
        title="Update dashboard now?"
        description="This pulls the latest dashboard code and rebuilds the family server. The screen will be unavailable briefly."
        confirmLabel="Update now"
        busy={updating}
        onConfirm={() => {
          setUpdateOpen(false);
          void runUpdate();
        }}
        onClose={() => {
          if (!updating) setUpdateOpen(false);
        }}
      >
        <p className="text-sm leading-6 text-text-secondary">Only continue when you are ready for the family server to restart.</p>
      </SettingsConfirmDialog>
    </div>
  );
}
