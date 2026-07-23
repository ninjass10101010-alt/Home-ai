"use client";

import { useState, useEffect } from "react";
import SoftButton from "@/components/ui/SoftButton";

export default function VersionCard() {
  const [data, setData] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<any[]>([]);
  const [updateDone, setUpdateDone] = useState(false);

  useEffect(() => {
    fetch("/api/admin/version")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ ok: false }));
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/admin/version", { cache: "no-store" });
      setData(await r.json());
    } catch {
      setData({ ok: false });
    }
    setChecking(false);
  };

  const updateNow = async () => {
    setUpdating(true);
    setUpdateLogs([]);
    setUpdateDone(false);
    try {
      const r = await fetch("/api/admin/update", { method: "POST" });
      const result = await r.json();
      setUpdateLogs(result.logs || []);
      if (result.ok) {
        setUpdateDone(true);
        setTimeout(() => window.location.reload(), 8000);
      }
    } catch (e: any) {
      setUpdateLogs([{ step: "error", status: "error", detail: e.message, timestamp: new Date().toISOString() }]);
    }
    setUpdating(false);
  };

  if (!data) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    );
  }

  const built = data.built_at || {};
  const remote = data.latest_remote;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {built.short && built.short !== "unknown" ? `Consuela Dashboard ${built.short}` : "Development build"}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{built.message || "—"}</p>
          {built.date && (
            <p className="text-[10px] text-text-muted">
              Built {new Date(built.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>
        {data.update_available && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-400">
            {data.commits_behind} behind
          </span>
        )}
        {!data.update_available && data.ok && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
            Up to date
          </span>
        )}
      </div>

      {remote && data.update_available && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-300">
            Latest: {remote.short} — {remote.message || "—"}
          </p>
          <p className="mt-1 text-[10px] text-text-muted">
            Run <span className="font-mono text-text-secondary">bash deploy.sh</span> on the QNAP or rebuild the Docker container to update.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <SoftButton onClick={checkNow} loading={checking} size="sm" className="flex-1">Check for updates</SoftButton>
        {data.update_available && (
          <SoftButton variant="secondary" size="sm" onClick={() => {
            localStorage.setItem("consuela-last-version-hash", remote.hash || "");
            window.open(`https://github.com/ninjass10101010-alt/Home-ai/compare/${built.hash}...${remote.hash}`, "_blank", "noopener,noreferrer");
          }} className="flex-1">View changes</SoftButton>
        )}
      </div>

      {data.update_available && (
        <SoftButton onClick={updateNow} loading={updating} variant="success" className="w-full">
          {updateDone ? "Done — reloading..." : "Update now (self-update)"}
        </SoftButton>
      )}

      {updateLogs.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 p-3">
          <p className="mb-2 text-[11px] font-semibold text-text-muted">Update progress:</p>
          <div className="space-y-1">
            {updateLogs.map((log: any, i: number) => (
              <div key={i} className={`flex items-start gap-2 text-[11px] ${log.status === "error" ? "text-rose-300" : log.status === "ok" ? "text-emerald-300" : "text-text-muted"}`}>
                <span className="shrink-0">{log.status === "ok" ? "✓" : log.status === "error" ? "✗" : "○"}</span>
                <span>{log.detail}</span>
              </div>
            ))}
          </div>
          {updateDone && <p className="mt-2 text-[11px] font-semibold text-emerald-300">✅ Update complete — page will reload in a few seconds...</p>}
        </div>
      )}
    </div>
  );
}
