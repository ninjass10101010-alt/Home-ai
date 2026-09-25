"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import { useAuth } from "@/hooks/useAuth";

interface FieldStatus {
  key: string;
  label: string;
  helpText?: string;
  secret: boolean;
  required: boolean;
  set: boolean;
  source: "db" | "env" | "unset";
  preview?: string;
  unreadable?: boolean;
}

interface ServiceEntry {
  id: string;
  displayName: string;
  description: string;
  status: FieldStatus[];
}

const LEGACY_STORAGE_KEY = "consuela-connections";

interface TestResult {
  ok: boolean;
  detail: string;
}

function dotTone(svc: ServiceEntry, tested: TestResult | null): { cls: string; label: string } {
  const hasUnreadable = svc.status.some((f) => f.unreadable && f.required);
  if (hasUnreadable) return { cls: "bg-[var(--color-accent-rose)]", label: "Saved — unreadable (re-enter)" };
  const requiredSet = svc.status.filter((f) => f.required).every((f) => f.set);
  if (!requiredSet) return { cls: "bg-[var(--color-accent-rose)]", label: "Not configured" };
  if (tested?.ok) return { cls: "bg-[var(--color-accent-mint)]", label: tested.detail || "Test passed" };
  if (tested && !tested.ok) return { cls: "bg-[var(--color-accent-rose)]", label: "Test failed" };
  return { cls: "bg-[var(--color-accent-amber)]", label: "Configured — untested" };
}

export default function ServicesKeysCard() {
  const { currentUser, hydrated } = useAuth();
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testedMap, setTestedMap] = useState<Record<string, TestResult | null>>({});
  const [busy, setBusy] = useState(false);
  const busyCountRef = useRef(0);
  const beginBusy = useCallback(() => {
    busyCountRef.current += 1;
    setBusy(true);
  }, []);
  const endBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1);
    if (busyCountRef.current === 0) setBusy(false);
  }, []);
  const [notice, setNotice] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [legacyBlob, setLegacyBlob] = useState<object | string | null>(null);

  const isParent = hydrated === true && currentUser?.role === "parent";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/services/config");
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const body = await res.json();
      setServices(body.services ?? []);
      setLoadFailed(false);
    } catch {
      /* offline — keep previous state */
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!isParent) return;
    const timer = window.setTimeout(() => {
      void load();
      try {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) setLegacyBlob(JSON.parse(raw));
      } catch {
        /* no legacy blob */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isParent, load]);

  const autoTestedRef = useRef(false);
  const testAll = useCallback(async (showNotice = true) => {
    beginBusy();
    const entries = services.filter((s) => s.status.filter((f) => f.required).every((f) => f.set));
    const results = await Promise.allSettled(
      entries.map(async (svc) => {
        const res = await fetch("/api/services/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service: svc.id }),
        });
        const body = await res.json().catch(() => null);
        return { id: svc.id, ok: res.ok && body?.ok === true, detail: body?.detail ?? "unknown" };
      })
    );
    const map: Record<string, TestResult> = {};
    results.forEach((result, index) => {
      const id = entries[index]?.id;
      if (!id) return;
      if (result.status === "fulfilled") {
        map[id] = { ok: result.value.ok, detail: String(result.value.detail) };
      } else {
        map[id] = { ok: false, detail: "Test request failed." };
      }
    });
    setTestedMap((m) => ({ ...m, ...map }));
    if (showNotice) setNotice("Connection tests complete.");
    endBusy();
  }, [services, beginBusy, endBusy]);

  useEffect(() => {
    if (!isParent || autoTestedRef.current || services.length === 0) return;
    autoTestedRef.current = true;
    void testAll(false);
  }, [isParent, services, testAll]);

  if (!isParent) return null;

  const importLegacy = async () => {
    try {
      const parsed = typeof legacyBlob === "string" ? JSON.parse(atob(String(legacyBlob))) : legacyBlob;
      // Legacy shape: { [serviceId]: { apiKey?... } } — map known entries.
      const entries: Array<{ service: string; key: string; value: string }> = [];
      const push = (service: string, key: string, value: unknown) => {
        if (typeof value === "string" && value) entries.push({ service, key, value });
      };
      const obj = parsed as Record<string, any>;
      push("instacart", "INSTACART_API_KEY", obj?.instacart?.apiKey ?? obj?.instacart?.api_key);
      push("composio", "COMPOSIO_API_KEY", obj?.composio?.apiKey ?? obj?.spotify?.apiKey ?? obj?.spotify?.api_key);
      push("greenlight", "GREENLIGHT_API_KEY", obj?.greenlight?.apiKey);
      push("khanacademy", "KHAN_API_KEY", obj?.khanacademy?.apiKey);
      push("home_assistant", "HA_HOST", obj?.homeassistant?.url ?? obj?.homeAssistant?.url);
      push("home_assistant", "HA_TOKEN", obj?.homeassistant?.token ?? obj?.homeAssistant?.token);

      if (entries.length === 0) {
        setNotice("Nothing importable found in the old connection store.");
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        setLegacyBlob(null);
        return;
      }

      beginBusy();
      const res = await fetch("/api/services/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        setLegacyBlob(null);
        setNotice(`Imported ${body.imported} key${body.imported === 1 ? "" : "s"}.`);
        await load();
      } else {
        setNotice("Import failed.");
      }
    } catch {
      setNotice("Import failed.");
    }
    endBusy();
  };

  const saveService = async (svc: ServiceEntry) => {
    beginBusy();
    setNotice("");
    try {
      for (const f of svc.status) {
        const draftKey = `${svc.id}.${f.key}`;
        if (!(draftKey in drafts)) continue;
        const value = drafts[draftKey];
        if (value === "") continue; // empty input = leave unchanged
        const res = await fetch("/api/services/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service: svc.id, key: f.key, value }),
        });
         if (!res.ok) {
           const body = await res.json().catch(() => ({ error: "save_failed" }));
           setNotice(body.error === "adult_only" ? "Adults only." : "Save failed.");
           return;
         }
      }
      setDrafts((d) => {
        const next = { ...d };
        for (const f of svc.status) delete next[`${svc.id}.${f.key}`];
        return next;
      });
      setNotice(`${svc.displayName} saved.`);
      await load();
    } catch {
      setNotice("Save failed.");
    } finally {
      endBusy();
    }
  };

  const clearField = async (svcId: string, key: string) => {
    beginBusy();
    setNotice("");
    try {
      const res = await fetch("/api/services/config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: svcId, key }),
      });
      const body = await res.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
      if (!res.ok || body?.ok !== true) {
        setNotice("Couldn't clear the saved override. Try again.");
        return;
      }
      setDrafts((d) => {
        const next = { ...d };
        delete next[`${svcId}.${key}`];
        return next;
      });
      setNotice("Override cleared — .env value applies again.");
      await load();
    } catch {
      setNotice("Couldn't clear the saved override. Try again.");
    } finally {
      endBusy();
    }
  };

  const testService = async (svcId: string) => {
    beginBusy();
    try {
      const res = await fetch("/api/services/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: svcId }),
      });
      const body = await res.json().catch(() => null);
      setTestedMap((m) => ({ ...m, [svcId]: { ok: Boolean(body?.ok), detail: String(body?.detail ?? "") } }));
      setNotice(body ? `${svcId}: ${body.detail}` : "Test failed to run.");
    } catch {
      setNotice("Test failed to run.");
    }
    endBusy();
  };

  const reconnectBridge = async () => {
    beginBusy();
    try {
      const res = await fetch("/api/services/home-assistant/reconnect", { method: "POST" });
      const body = await res.json().catch(() => null);
      setNotice(String(body?.message || body?.error || "Reconnect attempted."));
    } catch {
      setNotice("Reconnect failed.");
    }
    endBusy();
  };

  const eligibleServiceIds = new Set(
    services.filter((service) => service.status.filter((field) => field.required).every((field) => field.set)).map((service) => service.id),
  );
  const testedEntries = Object.entries(testedMap).filter(([id]) => eligibleServiceIds.has(id));
  const testedPassed = testedEntries.filter(([, result]) => result?.ok).length;

  return (
    <SectionCard
      title="Services & Keys"
      icon="🔑"
      tone="var(--color-accent-violet)"
      description="Connect the services Consuela uses. Secrets are encrypted and never shown after saving."
    >
      <div className="space-y-3">
        {legacyBlob && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-text-secondary">
              Found saved connection keys from an older version.
            </p>
             <SoftButton size="sm" loading={busy} disabled={busy} onClick={() => void importLegacy()}>
               Import
             </SoftButton>
          </div>
        )}

        {loadFailed && services.length === 0 && (
          <p className="text-sm text-text-secondary">
            Services config is unreachable right now — check the family server connection and reload.
          </p>
        )}

        {services.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {Object.keys(testedMap).length > 0
                ? `${testedPassed}/${testedEntries.length} passed`
                : "Testing…"}
            </p>
            <SoftButton
              size="sm"
              variant="secondary"
               loading={busy}
               disabled={busy}
               onClick={() => void testAll(true)}
            >
              Test all
            </SoftButton>
          </div>
        )}

        {services.map((svc) => {
          const dot = dotTone(svc, testedMap[svc.id] ?? null);
          const open = expanded === svc.id;
          // Save is enabled exactly when this service has unsaved drafts —
          // including rotating an existing DB override.
          const hasDrafts = svc.status.some((f) => `${svc.id}.${f.key}` in drafts);
          return (
            <div key={svc.id} className="rounded-xl border border-white/10 bg-[var(--color-surface-0)]/30">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
                 onClick={() => setExpanded(open ? null : svc.id)}
                 disabled={busy}
               >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dot.cls}`} aria-hidden />
                  <span className="text-sm font-semibold text-text-primary">{svc.displayName}</span>
                  {svc.status.some((f) => f.source === "db") && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-text-secondary">DB</span>
                  )}
                </span>
                <span className="text-xs text-text-muted">{open ? "Hide" : dot.label}</span>
              </button>

              {open && (
                <div className="space-y-3 border-t border-white/5 p-3">
                  <p className="text-xs text-text-muted">{svc.description}</p>
                  {svc.status.map((f) => {
                    const draftKey = `${svc.id}.${f.key}`;
                    return (
                      <div key={f.key} className="space-y-1">
                        <label className="block text-xs font-semibold text-text-secondary">
                          {f.label}
                          {f.required && <span className="ml-1 text-[var(--color-accent-rose)]">*</span>}
                          {f.secret && f.set && f.preview && (
                            <span className="ml-2 text-text-muted">•••{f.preview}</span>
                          )}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type={f.secret ? "password" : "text"}
                            inputMode={f.key === "LAT" || f.key === "LON" ? "decimal" : undefined}
                            autoComplete="off"
                            placeholder={
                              f.unreadable && f.secret
                                ? "Re-enter key — stored value unreadable"
                                : f.secret && f.set
                                  ? "•••••••• (leave blank to keep)"
                                  : f.source === "env" && f.set
                                    ? ".env value in use — type to override"
                                    : ""
                            }
                             value={drafts[draftKey] ?? ""}
                             disabled={busy}
                             onChange={(e) =>
                              setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))
                            }
                            className="w-full rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-selected/50"
                          />
                          {f.source === "db" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void clearField(svc.id, f.key)}
                              className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-text-secondary hover:bg-white/5 disabled:opacity-40"
                            >
                              Use .env
                            </button>
                          )}
                        </div>
                        {f.helpText && <p className="text-[11px] text-text-muted">{f.helpText}</p>}
                        {f.unreadable && (
                          <p className="text-[11px] text-[var(--color-accent-rose)]">
                            Saved but unreadable — the server&apos;s encryption key has changed since this was saved. Re-enter the value below.
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                     <SoftButton size="sm" loading={busy} onClick={() => void saveService(svc)} disabled={!hasDrafts || busy}>
                       Save
                     </SoftButton>
                     <SoftButton size="sm" variant="secondary" loading={busy} onClick={() => void testService(svc.id)} disabled={busy}>
                       Test
                     </SoftButton>
                     {svc.id === "home_assistant" && (
                       <SoftButton size="sm" variant="secondary" loading={busy} onClick={() => void reconnectBridge()} disabled={busy}>
                         Reconnect bridge
                       </SoftButton>
                     )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {notice && <p className="text-xs text-text-secondary">{notice}</p>}
      </div>
    </SectionCard>
  );
}
