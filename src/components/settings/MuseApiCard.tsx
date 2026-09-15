/* eslint-disable react-hooks/set-state-in-effect */
"use client";

// MUSE API — the inbound identity an external agent uses to connect to the
// dashboard. Adults manage it here: enable, admin toggle, mint/rotate the key
// (shown exactly once), revoke live tokens, cap the rate and watch the audit
// log. Every route is adult-session gated server-side (see /api/muse/*).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";

interface MuseSettings {
  enabled: boolean;
  adminEnabled: boolean;
  keyPrefix: string | null;
  version: number;
  createdAt: string | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  rateLimitPerMin: number;
  hasKey: boolean;
}

interface MuseLogEntry {
  at: string | null;
  kind: string | null;
  keyPrefix: string | null;
  tool: string | null;
  ok: boolean;
  ms: number | null;
  ip: string | null;
  detail: string | null;
  tokenAdmin: boolean;
}

const MIN_RATE = 10;
const MAX_RATE = 600;
const DEFAULT_RATE = 120;
const VISIBLE_LOG_ROWS = 10;

// SSR-safe origin: the server snapshot is empty, the client snapshot is the
// real location. useSyncExternalStore keeps this out of an effect (the
// repo's react-hooks/set-state-in-effect rule forbids setState in effects).
const subscribeNoop = () => () => {};
function clientOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}
function serverOrigin(): string {
  return "";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function failureCopy(shown: MuseLogEntry[]): string | null {
  const failed = shown.filter((e) => !e.ok).length;
  if (failed === 0) return null;
  return `${failed} of ${shown.length} recent calls failed.`;
}

export default function MuseApiCard() {
  const [settings, setSettings] = useState<MuseSettings | null>(null);
  const [entries, setEntries] = useState<MuseLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "rotate" | "revoke" | "rate">(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState(String(DEFAULT_RATE));
  const [rateError, setRateError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = useSyncExternalStore(subscribeNoop, clientOrigin, serverOrigin);

  const firstLoadRef = useRef(true);

  const applySettings = useCallback((body: MuseSettings) => {
    setSettings(body);
    setRateDraft(String(body.rateLimitPerMin ?? DEFAULT_RATE));
    setRateError(null);
  }, []);

  // A fresh server read can never contain the plaintext key, so every load
  // clears it — unless the caller just minted one (keepRevealed).
  const load = useCallback(
    async (opts?: { keepRevealed?: boolean }) => {
      if (!opts?.keepRevealed) setRevealedKey(null);
      setLoadError(null);
      setLogError(null);
      try {
        const res = await fetch("/api/muse/settings");
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) {
          if (res.status === 401) setLoadError("Sign in as a parent to manage MUSE.");
          else if (res.status === 403) setLoadError("Only a parent can manage MUSE.");
          else setLoadError("Couldn't reach the MUSE settings — try again.");
          return;
        }
        applySettings(body as MuseSettings);
      } catch {
        setLoadError("Couldn't reach the MUSE settings — try again.");
        return;
      } finally {
        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          setLoading(false);
        }
      }

      try {
        const res = await fetch("/api/muse/log?limit=20");
        const body = await res.json().catch(() => null);
        if (res.ok && body?.entries) setEntries(body.entries as MuseLogEntry[]);
        else setLogError("Couldn't load recent activity.");
      } catch {
        setLogError("Couldn't load recent activity.");
      }
    },
    [applySettings]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const putSettings = async (patch: Partial<Pick<MuseSettings, "enabled" | "adminEnabled">>) => {
    setBusy("toggle");
    setNotice(null);
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      const res = await fetch("/api/muse/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) setNotice("Couldn't save that change.");
      else setRevealedKey(null);
      await load();
    } catch {
      setNotice("Couldn't save that change.");
    } finally {
      setBusy(null);
    }
  };

  const rotateKey = async () => {
    setBusy("rotate");
    setNotice(null);
    try {
      const res = await fetch("/api/muse/settings/rotate", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.key) {
        setNotice("Couldn't generate a key.");
        return;
      }
      await load({ keepRevealed: true });
      setRevealedKey(String(body.key));
      setNotice(settings?.hasKey ? "Key rotated — every connected agent was signed out." : "Key generated.");
    } catch {
      setNotice("Couldn't generate a key.");
    } finally {
      setBusy(null);
    }
  };

  const revokeTokens = async () => {
    setBusy("revoke");
    setNotice(null);
    try {
      const res = await fetch("/api/muse/settings/revoke-tokens", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setNotice("All connected agents were signed out. The key is unchanged.");
        setRevealedKey(null);
      } else {
        setNotice("Couldn't revoke tokens.");
      }
      setRevokeOpen(false);
      await load();
    } catch {
      setNotice("Couldn't revoke tokens.");
      setRevokeOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const saveRate = async () => {
    const raw = rateDraft.trim();
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value) || value < MIN_RATE || value > MAX_RATE) {
      setRateError(`Enter a number between ${MIN_RATE} and ${MAX_RATE}.`);
      return;
    }
    setRateError(null);
    setBusy("rate");
    setNotice(null);
    try {
      const res = await fetch("/api/muse/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateLimitPerMin: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setNotice("Couldn't save the rate limit.");
        return;
      }
      applySettings(body as MuseSettings);
      setRevealedKey(null);
      setNotice(`Rate limit set to ${(body as MuseSettings).rateLimitPerMin} per minute.`);
    } catch {
      setNotice("Couldn't save the rate limit.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setNotice("Copy didn't work — select the text and copy it manually.");
    }
  };

  const baseUrl = origin || "http://<dashboard-host>:3000";
  const loginCurl = `curl -sS -X POST ${baseUrl}/api/muse/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"key":"muse_YOUR_KEY"}'`;

  const shown = entries.slice(0, VISIBLE_LOG_ROWS);
  const failures = failureCopy(shown);

  const revealedKeyBlock = revealedKey ? (
    <div className="space-y-2 rounded-2xl border border-[var(--color-accent-amber)]/40 bg-[color-mix(in_srgb,var(--color-accent-amber),transparent_88%)] p-3">
      <p className="text-[11px] font-semibold text-[var(--color-accent-amber)]">
        Save this now — it will not be shown again.
      </p>
      <code className="block break-all rounded-xl bg-black/30 px-3 py-2 text-xs text-text-primary">
        {revealedKey}
      </code>
      <SoftButton
        size="sm"
        variant="secondary"
        className="hit-44"
        onClick={() => void copy(revealedKey, "key")}
      >
        {copied === "key" ? "Copied ✓" : "Copy key"}
      </SoftButton>
    </div>
  ) : null;

  return (
    <SectionCard
      title="MUSE API"
      description="Let an external agent connect to the dashboard with its own login."
      icon="🤖"
      tone="#06b6d4"
    >
      {loading && !settings ? (
        <p className="text-sm text-text-secondary">Checking MUSE…</p>
      ) : loadError ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-accent-rose)]">{loadError}</p>
          <SoftButton size="sm" className="hit-44" onClick={() => void load()}>
            Try again
          </SoftButton>
          {revealedKeyBlock}
        </div>
      ) : settings ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
              <Toggle
                checked={settings.enabled}
                disabled={busy !== null}
                onCheckedChange={(v) => void putSettings({ enabled: v })}
                label="Enabled"
                description="Turn the MUSE API on or off."
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
              <Toggle
                checked={settings.adminEnabled}
                disabled={busy !== null}
                onCheckedChange={(v) => void putSettings({ adminEnabled: v })}
                label="Allow admin operations"
                description="Let MUSE call the guarded dashboard admin tools."
              />
              <p className="mt-2 text-[11px] text-[var(--color-accent-amber)]">
                Warning: with this on, MUSE could update or restart the dashboard containers. Leave it
                off unless you trust the connected agent.
              </p>
            </div>
          </div>

          <div className="space-y-1 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3">
            {settings.hasKey ? (
              <>
                <p className="text-sm font-semibold text-text-primary">Key {settings.keyPrefix}…</p>
                <p className="text-[11px] text-text-muted">
                  Version {settings.version} · Created {formatWhen(settings.createdAt)} · Rotated{" "}
                  {formatWhen(settings.rotatedAt)} · Last used {formatWhen(settings.lastUsedAt)}
                </p>
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                No key yet — generate one to let MUSE connect.
              </p>
            )}
          </div>

          {revealedKeyBlock}

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <SoftButton
                size="sm"
                className="hit-44"
                loading={busy === "rotate"}
                disabled={busy !== null && busy !== "rotate"}
                onClick={() => void rotateKey()}
                aria-label={settings.hasKey ? "Rotate MUSE key" : "Generate MUSE key"}
              >
                {settings.hasKey ? "Rotate key" : "Generate key"}
              </SoftButton>
              <SoftButton
                size="sm"
                variant="secondary"
                className="hit-44"
                disabled={!settings.hasKey || busy !== null}
                onClick={() => setRevokeOpen(true)}
                aria-label="Revoke MUSE tokens"
              >
                Revoke tokens
              </SoftButton>
            </div>
            <p className="text-[11px] text-text-muted">
              Rotating issues a new key and immediately signs out every connected agent. Revoking only
              signs agents out — the key keeps working for new logins.
            </p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="muse-rate"
              className="block text-xs font-semibold text-text-secondary"
            >
              Requests per minute ({MIN_RATE}–{MAX_RATE})
            </label>
            <div className="flex items-center gap-2">
              <input
                id="muse-rate"
                type="number"
                min={MIN_RATE}
                max={MAX_RATE}
                inputMode="numeric"
                value={rateDraft}
                onChange={(e) => {
                  setRateDraft(e.target.value);
                  if (rateError) setRateError(null);
                }}
                aria-invalid={rateError ? true : undefined}
                className="w-24 rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-selected/50"
              />
              <SoftButton
                size="sm"
                variant="secondary"
                className="hit-44"
                loading={busy === "rate"}
                disabled={busy !== null && busy !== "rate"}
                onClick={() => void saveRate()}
              >
                Save limit
              </SoftButton>
            </div>
            {rateError && (
              <p role="alert" className="text-[11px] text-[var(--color-accent-rose)]">
                {rateError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Recent activity
            </p>
            {logError && <p className="text-[11px] text-text-muted">{logError}</p>}
            {shown.length === 0 ? (
              <p className="text-[11px] text-text-muted">No MUSE activity yet.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {shown.map((entry, i) => (
                    <li
                      key={`${entry.at ?? "row"}-${i}`}
                      className="flex items-center gap-2 rounded-xl border border-white/5 bg-[var(--color-surface-0)]/30 px-3 py-2"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          entry.ok ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                        {entry.tool || entry.kind || "request"}
                        {entry.tokenAdmin ? " · admin" : ""}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {entry.ok ? "ok" : "failed"} · {relative(entry.at)}
                      </span>
                    </li>
                  ))}
                </ul>
                {failures && (
                  <p className="text-[11px] text-[var(--color-accent-rose)]">{failures}</p>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Connect an agent
            </p>
            <p className="text-[11px] text-text-muted">
              Base URL: <code className="text-text-secondary">{baseUrl}</code>
            </p>
            <pre className="overflow-x-auto rounded-xl bg-black/30 px-3 py-2 text-[11px] text-text-secondary">
              {loginCurl}
            </pre>
            <SoftButton
              size="sm"
              variant="secondary"
              className="hit-44"
              onClick={() => void copy(loginCurl, "curl")}
            >
              {copied === "curl" ? "Copied ✓" : "Copy login example"}
            </SoftButton>
          </div>

          {notice && <p className="text-[11px] text-text-secondary">{notice}</p>}
        </div>
      ) : null}

      <Modal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke all tokens?"
        description="This signs out any connected agent immediately. Your key keeps the same, so they can log in again."
        footer={
          <>
            <SoftButton
              size="sm"
              variant="ghost"
              className="hit-44 flex-1"
              onClick={() => setRevokeOpen(false)}
            >
              Cancel
            </SoftButton>
            <SoftButton
              size="sm"
              variant="danger"
              className="hit-44 flex-1"
              loading={busy === "revoke"}
              onClick={() => void revokeTokens()}
            >
              Sign out agents
            </SoftButton>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Every agent holding a token will have to log in again with the key. The key itself keeps
          working.
        </p>
      </Modal>
    </SectionCard>
  );
}
