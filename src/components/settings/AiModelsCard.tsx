"use client";

// AI Models — the dashboard-owned LLM brain (opencode-style manager).
// Shows the REAL answering chain (dashboard providers AND the read-only
// legacy/env fallback chain), manages providers + API keys (server-encrypted;
// the key value never round-trips to the browser), reorders the fallback
// chain, and surfaces the AI Health feed. Adults-only Integrations card.

import { useCallback, useEffect, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import TextField from "@/components/ui/TextField";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/hooks/useAuth";

interface ProviderRow {
  id: string;
  displayName: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  order: number;
  keyPreview: string | null;
  status: "ok" | "unreachable" | "unknown";
}

interface EnvProviderRow {
  provider: string;
  baseUrl: string;
  models: string[];
  keyPreview: string | null;
  readOnly: true;
}

interface HealthOutcome {
  ts: number;
  outcome: "ok" | "wrapup" | "exhausted" | "snag" | "client_gone" | "unconfigured";
  agent: string;
  rounds: number;
  ms: number;
  brain: string | null;
  targets: number;
  reason?: string;
}

interface HealthSummary {
  total: number;
  ok: number;
  wrapup: number;
  exhausted: number;
  snag: number;
  clientGone: number;
  unconfigured: number;
  avgMs: number;
  lastFailure: HealthOutcome | null;
}

interface Draft {
  id?: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  order: number;
}

const EMPTY_DRAFT: Draft = { displayName: "", baseUrl: "", apiKey: "", models: [], enabled: true, order: 0 };

// Matches ServicesKeysCard's dot idiom (emerald/rose/amber semantic dots).
function statusDot(status: ProviderRow["status"]): string {
  if (status === "ok") return "bg-[var(--color-accent-mint)]";
  if (status === "unreachable") return "bg-[var(--color-accent-rose)]";
  return "bg-[var(--color-accent-amber)]";
}

function outcomeDot(outcome: HealthOutcome["outcome"]): string {
  if (outcome === "ok") return "bg-[var(--color-accent-mint)]";
  if (outcome === "wrapup") return "bg-[var(--color-accent-cyan)]";
  if (outcome === "exhausted") return "bg-[var(--color-accent-amber)]";
  return "bg-[var(--color-accent-rose)]"; // snag / client_gone / unconfigured
}

function outcomeLabel(outcome: HealthOutcome["outcome"]): string {
  if (outcome === "ok") return "ok";
  if (outcome === "wrapup") return "wrap-up";
  if (outcome === "exhausted") return "ran out of steps";
  if (outcome === "snag") return "timeout";
  if (outcome === "client_gone") return "client left";
  return "no brain";
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function AiModelsCard() {
  const { isParent } = useAuth();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [envProviders, setEnvProviders] = useState<EnvProviderRow[]>([]);
  const [active, setActive] = useState<{ provider: string; model: string } | null>(null);
  const [health, setHealth] = useState<{ outcomes: HealthOutcome[]; summary: HealthSummary } | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fetchedIds, setFetchedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ProviderRow | null>(null);
  const [reordering, setReordering] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({}); // providerId → "ok — N models · Xms" | error
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/ai/providers");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = await res.json();
      setProviders(body.providers ?? []);
      setEnvProviders(body.envProviders ?? []);
      setActive(body.active ?? null);
    } catch {
      setLoadError("Couldn't reach the provider store — try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthErr(false);
    try {
      const res = await fetch("/api/ai/health");
      if (!res.ok) { setHealthErr(true); return; } // health is a bonus panel — never break the card
      const body = await res.json();
      setHealth(body);
    } catch { setHealthErr(true); }
  }, []);

  useEffect(() => {
    void load();
    void loadHealth();
  }, [load, loadHealth]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      setNotice(`Saved ${draft.displayName}.`);
      setFetchedIds([]);
      setDraft(null);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async () => {
    if (!confirmRemove) return;
    const { id, displayName } = confirmRemove;
    setConfirmRemove(null);
    const res = await fetch(`/api/ai/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setNotice(`Removed ${displayName}.`);
    else setNotice("Couldn't remove that provider.");
    await load();
  };

  const moveModel = async (p: ProviderRow, index: number, dir: -1 | 1) => {
    const next = [...p.models];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setNotice(`Reordering models in ${p.displayName}…`);
    const res = await fetch("/api/ai/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, displayName: p.displayName, baseUrl: p.baseUrl, models: next, enabled: p.enabled, order: p.order }),
    });
    setNotice(res.ok ? `Model order updated — ${next[0]} answers first.` : "Couldn't save the new order.");
    await load();
  };

  const moveProvider = async (index: number, dir: -1 | 1) => {
    const swap = index + dir;
    if (swap < 0 || swap >= providers.length || reordering) return;
    const a = providers[index];
    const b = providers[swap];
    setReordering(true);
    setNotice(`Reordering providers…`);
    // Swap the two providers' order values (both PUTs land before reload).
    const putA = fetch("/api/ai/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, displayName: a.displayName, baseUrl: a.baseUrl, models: a.models, enabled: a.enabled, order: b.order }),
    });
    const putB = fetch("/api/ai/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, displayName: b.displayName, baseUrl: b.baseUrl, models: b.models, enabled: b.enabled, order: a.order }),
    });
    try {
      const [ra, rb] = await Promise.all([putA, putB]);
      if (ra.ok && rb.ok) {
        setNotice(`${b.displayName} is now the brain.`);
      } else {
        // Honest partial-failure message — the reload below re-reads truth.
        setNotice("One side of the swap failed — the list may need a refresh.");
      }
    } catch {
      setNotice("Couldn't save the new order.");
    } finally {
      setReordering(false);
      await load();
    }
  };

  const testProvider = async (p: ProviderRow) => {
    setTesting(p.id);
    setTestResult((m) => ({ ...m, [p.id]: "testing…" }));
    const started = Date.now();
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: p.id, baseUrl: p.baseUrl }),
      });
      const body = await res.json().catch(() => ({}));
      const ms = Date.now() - started;
      if (!res.ok) throw new Error(body.error || `status ${res.status}`);
      const n = (body.models as unknown[] | undefined)?.length ?? 0;
      setTestResult((m) => ({ ...m, [p.id]: `ok — ${n} models · ${ms}ms` }));
    } catch (err) {
      setTestResult((m) => ({ ...m, [p.id]: `failed: ${(err as Error).message}` }));
    } finally {
      setTesting(null);
    }
  };

  const loadModels = async () => {
    if (!draft) return;
    setListing(true);
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: draft.id, baseUrl: draft.baseUrl, apiKey: draft.apiKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "listing failed");
      const ids: string[] = (body.models ?? []).map((m: { id: string }) => m.id);
      if (ids.length === 0) throw new Error("provider listed no models — enter names manually");
      setDraft((d) => (d ? { ...d, models: d.models.length ? d.models : [ids[0]] } : d));
      setFetchedIds(ids);
      setNotice(`${ids.length} models available — tap the ones you want; the first one in the chain answers.`);
    } catch (err) {
      setNotice(`${(err as Error).message}`);
    } finally {
      setListing(false);
    }
  };

  const h = health?.summary;
  // The Brain badge belongs to the provider chat actually starts with — the
  // first ENABLED one (resolveChatTargets ignores disabled rows), never row 0.
  const firstEnabledIdx = providers.findIndex((p) => p.enabled && p.models.length > 0);

  return (
    <SectionCard
      title="AI Models"
      description="Consuela's brain — pick the provider and model that answers."
      icon="🧠"
      tone="#8b5cf6"
    >
      {loading ? (
        <p className="text-sm text-text-secondary">Checking the brain…</p>
      ) : loadError ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-accent-rose)]">{loadError}</p>
          <SoftButton size="sm" onClick={() => void load()}>Try again</SoftButton>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
            <span aria-hidden>🧠</span>
            {active ? (
              <span className="text-sm font-semibold text-text-primary">
                Currently loaded: {active.model} · via {active.provider}
              </span>
            ) : (
              <span className="text-sm text-text-secondary">
                No brain configured — add a provider below.
              </span>
            )}
          </div>

          {providers.map((p, pIdx) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(p.status)}`} aria-hidden />
                    <span className="truncate text-sm font-semibold text-text-primary">{p.displayName}</span>
                    {pIdx === firstEnabledIdx && (
                      <span className="rounded-full bg-[var(--color-accent-button)] px-2 py-0.5 text-[11px] font-bold text-white">Brain</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-text-muted">
                    {p.baseUrl}{p.keyPreview ? ` · key …${p.keyPreview}` : " · no key"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {isParent && (
                    <>
                      <IconButton
                        size="md"
                        variant="ghost"
                        aria-label={`Move ${p.displayName} up`}
                        disabled={pIdx === 0 || reordering}
                        onClick={() => void moveProvider(pIdx, -1)}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        size="md"
                        variant="ghost"
                        aria-label={`Move ${p.displayName} down`}
                        disabled={pIdx === providers.length - 1 || reordering}
                        onClick={() => void moveProvider(pIdx, 1)}
                      >
                        ↓
                      </IconButton>
                      <IconButton
                        size="md"
                        variant="ghost"
                        aria-label={`Test ${p.displayName}`}
                        onClick={() => void testProvider(p)}
                      >
                        ⚡
                      </IconButton>
                      <IconButton
                        size="md"
                        variant="ghost"
                        aria-label={`Edit ${p.displayName}`}
                        onClick={() => { setFetchedIds([]); setDraft({ id: p.id, displayName: p.displayName, baseUrl: p.baseUrl, apiKey: "", models: p.models, enabled: p.enabled, order: p.order }); }}
                      >
                        ✎
                      </IconButton>
                      <IconButton size="md" variant="ghost" aria-label={`Remove ${p.displayName}`} onClick={() => setConfirmRemove(p)}>
                        🗑️
                      </IconButton>
                    </>
                  )}
                </div>
              </div>
              {/* The model chain, live — first model answers, the rest catch failures. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.models.map((m, i) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[var(--color-surface-0)] px-2 py-0.5">
                    <span className="text-[11px] font-semibold text-text-primary">{m}</span>
                    {i === 0 && pIdx === firstEnabledIdx ? (
                      <span className="text-[10px] font-bold text-[var(--color-accent-mint)]">Brain</span>
                    ) : (
                      <span className="text-[10px] text-text-muted">Fallback</span>
                    )}
                    {isParent && i > 0 && (
                      <button
                        type="button"
                        aria-label={`Move ${m} up`}
                        className="text-[10px] text-text-secondary hover:text-text-primary"
                        onClick={() => void moveModel(p, i, -1)}
                      >
                        ↑
                      </button>
                    )}
                    {isParent && i < p.models.length - 1 && (
                      <button
                        type="button"
                        aria-label={`Move ${m} down`}
                        className="text-[10px] text-text-secondary hover:text-text-primary"
                        onClick={() => void moveModel(p, i, 1)}
                      >
                        ↓
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {testing === p.id && <p className="mt-1 text-[11px] text-text-secondary">Testing…</p>}
              {testResult[p.id] && testing !== p.id && (
                <p className={`mt-1 text-[11px] ${testResult[p.id].startsWith("ok") ? "text-[var(--color-accent-mint)]" : "text-[var(--color-accent-rose)]"}`}>
                  {testResult[p.id]}
                </p>
              )}
            </div>
          ))}

          {/* Read-only env / legacy-fallback chain — honest visibility into what
              is answering when NO dashboard providers exist, without turning
              env config into an editable lie. */}
          {envProviders.map((g) => (
            <div key={`${g.provider}::${g.baseUrl}`} className="rounded-2xl border border-dashed border-white/15 bg-[var(--color-surface-2)]/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent-amber)]" aria-hidden />
                <span className="truncate text-sm font-semibold text-text-primary">{g.provider}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-text-muted">read-only · env</span>
              </div>
              <p className="truncate text-[11px] text-text-muted">
                {g.baseUrl}{g.keyPreview ? ` · key …${g.keyPreview}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {g.models.map((m, i) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[var(--color-surface-0)] px-2 py-0.5">
                    <span className="text-[11px] font-semibold text-text-primary">{m}</span>
                    {i === 0 ? (
                      <span className="text-[10px] font-bold text-[var(--color-accent-mint)]">Brain</span>
                    ) : (
                      <span className="text-[10px] text-text-muted">Fallback</span>
                    )}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                Set via environment/fallback config — add a provider below to take over.
              </p>
            </div>
          ))}

          {!draft && isParent && (
            <SoftButton size="sm" onClick={() => { setFetchedIds([]); setDraft({ ...EMPTY_DRAFT, order: providers.length }); }}>+ Add provider</SoftButton>
          )}

          {draft && (
            <div className="space-y-3 rounded-2xl border border-[var(--color-accent-selected)]/40 bg-[var(--color-surface-2)] p-4">
              <TextField
                label="Name"
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                placeholder="b.ai free tier"
              />
              <TextField
                label="API base URL"
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="https://api.b.ai/v1"
              />
              <TextField
                label={draft.id ? `API key (leave blank to keep …${providers.find((p) => p.id === draft.id)?.keyPreview ?? ""})` : "API key"}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder={draft.id ? "unchanged" : "sk-…"}
                autoComplete="off"
              />
              <div className="flex items-center gap-2">
                <SoftButton size="sm" loading={listing} disabled={!draft.baseUrl} onClick={() => void loadModels()}>
                  Load models
                </SoftButton>
                <span className="text-[11px] text-text-muted">or type names below</span>
              </div>
              {fetchedIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fetched models — tap to toggle">
                  {fetchedIds.map((id) => {
                    const included = draft.models.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={included}
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? { ...d, models: included ? d.models.filter((m) => m !== id) : [...d.models, id] }
                              : d
                          )
                        }
                        className={
                          included
                            ? "rounded-full bg-[var(--color-accent-button)] px-2.5 py-1 text-[11px] font-semibold text-white"
                            : "rounded-full border border-white/10 bg-[var(--color-surface-0)] px-2.5 py-1 text-[11px] font-semibold text-text-secondary"
                        }
                      >
                        {id}
                      </button>
                    );
                  })}
                </div>
              )}
              <TextField
                label="Models (comma-separated, first = in use)"
                value={draft.models.join(", ")}
                onChange={(e) => setDraft({ ...draft, models: e.target.value.split(",").map((m) => m.trim()).filter(Boolean) })}
                placeholder="glm-5.3-flash, qwen3.8-flash"
              />
              <div className="flex items-center justify-between">
                <Toggle
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                  label="Enabled"
                />
                <div className="flex gap-2">
                  <SoftButton size="sm" variant="ghost" onClick={() => { setFetchedIds([]); setDraft(null); }}>Cancel</SoftButton>
                  <SoftButton
                    size="sm"
                    loading={saving}
                    disabled={!draft.displayName || !draft.baseUrl || draft.models.length === 0}
                    onClick={() => void save()}
                  >
                    Save provider
                  </SoftButton>
                </div>
              </div>
            </div>
          )}

          {notice && <p className="text-[11px] text-text-secondary">{notice}</p>}
          {providers.length === 0 && envProviders.length === 0 && (
            <p className="text-[11px] text-text-muted">
              The brain chain is: provider 1&apos;s first model answers, later models/providers catch failures.
            </p>
          )}

          {/* AI Health — admin visibility into chat outcomes (was: silent
              "ran out of steps" with no way to tell timeout vs exhaustion). */}
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-text-primary">AI Health</span>
              <button
                type="button"
                onClick={() => void loadHealth()}
                aria-label="Refresh AI health"
                className="text-[11px] font-semibold text-text-secondary hover:text-text-primary"
              >
                Refresh
              </button>
            </div>
            {healthErr ? (
              <p className="mt-1 text-[11px] text-text-muted">Health feed unavailable — tap Refresh to retry.</p>
            ) : !h || h.total === 0 ? (
              <p className="mt-1 text-[11px] text-text-muted">No chat requests recorded since the dashboard last restarted.</p>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-text-secondary">
                  Last {h.total}: {h.ok} ok{h.wrapup ? ` · ${h.wrapup} wrap-up` : ""}
                  {h.exhausted ? ` · ${h.exhausted} ran out of steps` : ""}
                  {h.snag ? ` · ${h.snag} timeout` : ""}
                  {h.clientGone ? ` · ${h.clientGone} client left` : ""} · avg {(h.avgMs / 1000).toFixed(1)}s
                </p>
                {h.lastFailure && (
                  <p className="mt-1 text-[11px] text-[var(--color-accent-rose)]">
                    Last failure: {outcomeLabel(h.lastFailure.outcome)}
                    {h.lastFailure.reason ? ` — ${h.lastFailure.reason}` : ""} · {ago(h.lastFailure.ts)}
                  </p>
                )}
                {health && health.outcomes.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Recent outcomes">
                    {health.outcomes.slice(0, 12).map((o, i) => (
                      <span
                        key={`${o.ts}-${i}`}
                        title={`${outcomeLabel(o.outcome)} · ${o.rounds} round${o.rounds === 1 ? "" : "s"} · ${(o.ms / 1000).toFixed(1)}s · ${ago(o.ts)}`}
                        className={`h-2.5 w-2.5 rounded-full ${outcomeDot(o.outcome)}`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title={confirmRemove ? `Remove ${confirmRemove.displayName}?` : "Remove provider?"}
        description="The provider and its models leave the brain chain. If it was the brain, the next provider (or env fallback) takes over. This can't be undone."
        footer={
          <div className="flex justify-end gap-2">
            <SoftButton size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</SoftButton>
            <SoftButton size="sm" onClick={() => void removeProvider()}>Remove provider</SoftButton>
          </div>
        }
      >
        <p className="text-sm text-text-secondary">
          {confirmRemove
            ? `Base URL: ${confirmRemove.baseUrl} — ${confirmRemove.models.length} model(s) in its chain.`
            : ""}
        </p>
      </Modal>
    </SectionCard>
  );
}
