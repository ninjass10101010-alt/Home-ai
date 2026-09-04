"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import { useAuth } from "@/hooks/useAuth";

type FrameState = "checking" | "ready" | "error";

const subscribeNoop = () => () => {};

// Upstream health probe: the proxy serves the ledger app; a failed dashboard
// read means the finance container is unreachable.
async function probeLedger(): Promise<FrameState> {
  try {
    const res = await fetch("/api/data/dashboard", { cache: "no-store" });
    return res.ok ? "ready" : "error";
  } catch {
    return "error";
  }
}

export default function LedgerPage() {
  const { isParent } = useAuth();
  // SSR renders the deterministic "checking" frame; mounted clients resolve
  // auth and the upstream health check (middleware is the real gate).
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [frame, setFrame] = useState<FrameState>("checking");

  const retry = useCallback(() => {
    setFrame("checking");
    void probeLedger().then(setFrame);
  }, []);

  useEffect(() => {
    if (!mounted || !isParent) return;
    let cancelled = false;
    void probeLedger().then((next) => {
      if (!cancelled) setFrame(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, isParent]);

  return (
    <PageShell>
      <PageHeader
        title="The Ledger"
        subtitle="Alex's finance tracker — parents only"
        icon="📒"
        action={
          <a
            href="/ledger-app/"
            target="_blank"
            rel="noopener noreferrer"
            className="tap-sm rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-text-secondary"
          >
            Open full size ↗
          </a>
        }
      />
      <div className="px-4 pb-6">
        {!mounted || (isParent && frame === "checking") ? (
          <div className="grid h-[calc(100dvh-220px)] place-items-center rounded-3xl border border-white/10 bg-white/5">
            <p className="text-sm text-text-secondary">{mounted ? "Opening The Ledger…" : "\u00A0"}</p>
          </div>
        ) : !isParent ? (
          <div className="grid place-items-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
            <div className="text-4xl">🔒</div>
            <p className="mt-3 text-sm text-text-secondary">
              The Ledger is for parents only — ask Mom or Dad to sign in.
            </p>
          </div>
        ) : frame === "error" ? (
          <div className="grid place-items-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
            <div className="text-4xl">📒</div>
            <p className="mt-3 text-sm text-text-secondary">The Ledger is unreachable right now.</p>
            <button
              type="button"
              onClick={retry}
              className="tap-sm mt-4 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-text-primary"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/60 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)]">
            {/* Window chrome: honestly frames the embedded app as Alex's, so the
                cream editorial world reads as a deliberate window, not a theme clash. */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden className="text-base leading-none">📒</span>
                <span className="truncate text-sm font-semibold text-text-primary">The Ledger</span>
                <span className="hidden truncate text-xs text-text-muted sm:inline">— Alex&apos;s finance app</span>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-text-secondary">
                Opens Alex&apos;s app
              </span>
            </div>
            <iframe
              src="/ledger-app/"
              title="The Ledger — Alex's finance tracker"
              className="block h-[calc(100dvh-264px)] w-full"
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
