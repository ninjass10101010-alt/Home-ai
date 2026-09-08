"use client";

// AI Models — the dashboard-owned LLM brain (opencode-style manager).
// Shows which model is loaded, manages providers + API keys (server-encrypted;
// the key value never round-trips to the browser) and orders the fallback
// chain. Rendered inside the adults-only Integrations card on /settings.

import { useCallback, useEffect, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import TextField from "@/components/ui/TextField";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toggle from "@/components/ui/Toggle";

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
  if (status === "ok") return "bg-emerald-400";
  if (status === "unreachable") return "bg-rose-400";
  return "bg-amber-300";
}

export default function AiModelsCard() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [active, setActive] = useState<{ provider: string; model: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listing, setListing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/ai/providers");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = await res.json();
      setProviders(body.providers ?? []);
      setActive(body.active ?? null);
    } catch {
      setLoadError("Couldn't reach the provider store — try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      setDraft(null);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    const res = await fetch(`/api/ai/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setNotice(`Removed ${name}.`);
    else setNotice("Couldn't remove that provider.");
    await load();
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
      setNotice(`${ids.length} models available — toggle the ones you want, order with the arrows.`);
    } catch (err) {
      setNotice(`${(err as Error).message}`);
    } finally {
      setListing(false);
    }
  };

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

          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(p.status)}`} aria-hidden />
                  <span className="truncate text-sm font-semibold text-text-primary">{p.displayName}</span>
                  {p.enabled && p.models[0] && active?.model === p.models[0] && (
                    <span className="rounded-full bg-[var(--color-accent-button)] px-2 py-0.5 text-[11px] font-bold text-white">In use</span>
                  )}
                </div>
                <p className="truncate text-[11px] text-text-muted">
                  {p.baseUrl} · {p.models.length} model(s){p.keyPreview ? ` · key …${p.keyPreview}` : " · no key"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton
                  size="md"
                  variant="ghost"
                  aria-label={`Edit ${p.displayName}`}
                  onClick={() => setDraft({ id: p.id, displayName: p.displayName, baseUrl: p.baseUrl, apiKey: "", models: p.models, enabled: p.enabled, order: p.order })}
                >
                  ✎
                </IconButton>
                <IconButton size="md" variant="ghost" aria-label={`Remove ${p.displayName}`} onClick={() => void remove(p.id, p.displayName)}>
                  🗑️
                </IconButton>
              </div>
            </div>
          ))}

          {!draft && (
            <SoftButton size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT, order: providers.length })}>+ Add provider</SoftButton>
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
                  <SoftButton size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</SoftButton>
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
          {providers.length === 0 && (
            <p className="text-[11px] text-text-muted">
              The brain chain is: provider 1&apos;s first model answers, later models/providers catch failures.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
