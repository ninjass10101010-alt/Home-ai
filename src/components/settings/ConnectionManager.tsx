/**
 * ConnectionManager — Unified UI for managing all integrations.
 *
 * Features:
 *   - Search/filter integrations
 *   - Category grouping
 *   - One-click connect with credential input
 *   - Connection status indicators
 *   - Test connection before saving
 *   - Disconnect at any time
 *   - "Get API Key" links to provider setup pages
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import FormField from "@/components/patterns/FormField";
import { CONNECTIONS, CATEGORY_LABELS, type ConnectionConfig } from "@/lib/connections/registry";
import type { ConnectionStatus, ConnectionCredentials, StoredConnection } from "@/lib/connections/types";
import { loadConnections, connect, disconnect, isConnected, updateStatus } from "@/lib/connections/store";

interface ConnectionManagerProps {
  showToast: (message: string) => void;
}

export default function ConnectionManager({ showToast }: ConnectionManagerProps) {
  const [connections, setConnections] = useState<Record<string, StoredConnection>>({});
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [connectModal, setConnectModal] = useState<ConnectionConfig | null>(null);
  const [formValues, setFormValues] = useState<ConnectionCredentials>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setConnections(loadConnections());
  }, []);

  const refresh = useCallback(() => {
    setConnections(loadConnections());
  }, []);

  // Filtered connections
  const filtered = useMemo(() => {
    let list = CONNECTIONS;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      );
    }
    if (selectedCategory) {
      list = list.filter((c) => c.category === selectedCategory);
    }
    return list;
  }, [search, selectedCategory]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, ConnectionConfig[]> = {};
    for (const conn of filtered) {
      if (!groups[conn.category]) groups[conn.category] = [];
      groups[conn.category].push(conn);
    }
    return groups;
  }, [filtered]);

  // Categories present in filtered results
  const categories = useMemo(() => {
    const cats = new Set(filtered.map((c) => c.category));
    return Array.from(cats);
  }, [filtered]);

  const getStatus = useCallback(
    (id: string): ConnectionStatus => {
      return connections[id]?.status || "disconnected";
    },
    [connections],
  );

  const openConnectModal = useCallback((config: ConnectionConfig) => {
    setConnectModal(config);
    // Pre-fill with existing credentials
    const existing = connections[config.id];
    if (existing?.credentials) {
      setFormValues({ ...existing.credentials });
    } else {
      setFormValues({});
    }
    setTestResult(null);
  }, [connections]);

  const handleTest = useCallback(async () => {
    if (!connectModal) return;
    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connectModal.id, credentials: formValues }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message });

      if (data.success) {
        // Save the connection
        connect(connectModal.id, formValues);
        refresh();
        showToast(`✅ ${connectModal.name} connected!`);
        setTimeout(() => {
          setConnectModal(null);
          setTestResult(null);
        }, 1500);
      }
    } catch (error: any) {
      setTestResult({ success: false, message: error.message || "Connection failed" });
    } finally {
      setTesting(false);
    }
  }, [connectModal, formValues, refresh, showToast]);

  const handleDisconnect = useCallback((config: ConnectionConfig) => {
    disconnect(config.id);
    refresh();
    showToast(`🔌 ${config.name} disconnected`);
  }, [refresh, showToast]);

  // ─── Stats ──────────────────────────────────────────────────────────────
  const totalConnections = CONNECTIONS.length;
  const activeConnections = Object.values(connections).filter((c) => c.status === "connected").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-text-primary">Connected Services</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {activeConnections} of {totalConnections} services connected
          </p>
        </div>
        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          <div className="h-2 w-20 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(activeConnections / totalConnections) * 100}%`,
                background: "linear-gradient(90deg, var(--color-accent-selected), var(--color-accent-mint))",
              }}
            />
          </div>
          <span className="text-xs font-bold text-text-secondary tabular-nums">
            {Math.round((activeConnections / totalConnections) * 100)}%
          </span>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services..."
            className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-2)] pl-9 pr-4 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-dim focus:border-[var(--color-accent-selected)]/40 transition-colors"
          />
        </div>
        <select
          value={selectedCategory || ""}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-text-primary outline-none appearance-none cursor-pointer"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]?.emoji || "📦"} {CATEGORY_LABELS[cat]?.label || cat}
            </option>
          ))}
        </select>
      </div>

      {/* Connection Cards by Category */}
      {Object.entries(grouped).map(([category, conns]) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{CATEGORY_LABELS[category]?.emoji || "📦"}</span>
            <h4 className="text-sm font-bold text-text-primary">{CATEGORY_LABELS[category]?.label || category}</h4>
            <span className="text-[10px] font-semibold text-text-muted">
              {conns.filter((c) => isConnected(c.id)).length}/{conns.length} connected
            </span>
          </div>
          <div className="space-y-2">
            {conns.map((config) => (
              <ConnectionCard
                key={config.id}
                config={config}
                status={getStatus(config.id)}
                onConnect={() => openConnectModal(config)}
                onDisconnect={() => handleDisconnect(config)}
              />
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-8">
          <span className="text-3xl block mb-2">🔍</span>
          <p className="text-sm text-text-muted">No services match your search</p>
        </div>
      )}

      {/* Connect Modal */}
      <Modal
        open={Boolean(connectModal)}
        onClose={() => { setConnectModal(null); setTestResult(null); }}
        title={connectModal ? `Connect ${connectModal.emoji} ${connectModal.name}` : ""}
        description={connectModal?.description}
        footer={
          connectModal ? (
            <>
              <SoftButton variant="secondary" onClick={() => setConnectModal(null)} className="flex-1">
                Cancel
              </SoftButton>
              <SoftButton
                onClick={handleTest}
                loading={testing}
                disabled={!connectModal.fields.filter((f) => f.required).every((f) => formValues[f.key]?.trim())}
                className="flex-1"
              >
                {testResult?.success ? "✅ Connected!" : testing ? "Testing..." : "Connect"}
              </SoftButton>
            </>
          ) : undefined
        }
      >
        {connectModal && (
          <div className="space-y-4">
            {/* Features list */}
            <Surface variant="glass-subtle" radius="xl" padding="sm">
              <h4 className="text-xs font-bold text-text-primary mb-2">This enables:</h4>
              <ul className="space-y-1">
                {connectModal.features.slice(0, 4).map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </Surface>

            {/* Credential fields */}
            {connectModal.fields.map((field) => (
              <FormField key={field.key} label={field.label}>
                <input
                  type={field.type === "password" ? "password" : "text"}
                  value={formValues[field.key] || ""}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-dim focus:border-[var(--color-accent-selected)]/40 transition-colors"
                />
                {field.helpText && (
                  <p className="mt-1 text-[10px] text-text-muted">{field.helpText}</p>
                )}
              </FormField>
            ))}

            {/* Setup link */}
            {connectModal.setupUrl && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">Need an API key?</span>
                <a
                  href={connectModal.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent-selected)] font-semibold hover:underline"
                >
                  Get one here →
                </a>
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div
                className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                  testResult.success
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                {testResult.success ? "✅" : "❌"} {testResult.message}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── Connection Card ────────────────────────────────────────────────────────

function ConnectionCard({
  config,
  status,
  onConnect,
  onDisconnect,
}: {
  config: ConnectionConfig;
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConn = status === "connected";

  return (
    <div
      className={`rounded-2xl border transition-all ${
        isConn
          ? "border-emerald-500/20 bg-emerald-500/[0.03]"
          : "border-white/[0.06] bg-[var(--color-surface-0)]/20"
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 p-4">
        {/* Emoji icon */}
        <div
          className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0"
          style={{
            background: isConn ? "rgba(74, 222, 128, 0.1)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${isConn ? "rgba(74, 222, 128, 0.15)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {config.emoji}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-text-primary">{config.name}</h4>
            {isConn && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                Connected
              </span>
            )}
            {!config.available && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--color-surface-3)] text-text-muted">
                Premium
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5 truncate">{config.description}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={expanded ? "Show less" : "Show features"}
            onClick={() => setExpanded(!expanded)}
          >
            <span className="text-xs">{expanded ? "▲" : "▼"}</span>
          </IconButton>

          {isConn ? (
            <SoftButton variant="ghost" size="sm" onClick={onDisconnect}>
              Disconnect
            </SoftButton>
          ) : (
            <SoftButton size="sm" onClick={onConnect} disabled={!config.available}>
              Connect
            </SoftButton>
          )}
        </div>
      </div>

      {/* Expanded features */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
          <h5 className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
            What this enables:
          </h5>
          <ul className="space-y-1.5">
            {config.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                <span className={`mt-0.5 shrink-0 ${isConn ? "text-emerald-400" : "text-text-dim"}`}>
                  {isConn ? "✓" : "○"}
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          {config.setupUrl && !isConn && (
            <div className="mt-3 pt-2 border-t border-white/[0.04]">
              <a
                href={config.setupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-accent-selected)] font-semibold hover:underline"
              >
                Get API Key →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
