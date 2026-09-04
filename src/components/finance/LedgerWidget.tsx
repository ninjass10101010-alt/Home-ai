/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SectionCard from "@/components/patterns/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import {
  formatUSD,
  summarizeLedger,
  type LedgerDashboardPayload,
  type LedgerSummary,
} from "@/lib/finance/ledger-summary";

type LoadState = "loading" | "ok" | "error";

export default function LedgerWidget({ className = "" }: { className?: string }) {
  const { isParent } = useAuth();
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [status, setStatus] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/data/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as LedgerDashboardPayload;
      const next = summarizeLedger(payload);
      if (!next) throw new Error("empty payload");
      setSummary(next);
      setStatus("ok");
    } catch {
      setSummary(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (isParent) void load();
  }, [isParent, load]);

  // Defense in depth — page.tsx also filters this widget out for
  // non-parents, so it never occupies a grid cell for kids/guests.
  if (!isParent) return null;

  return (
    <SectionCard
      tone="#22c55e"
      icon="📒"
      title="The Ledger"
      description="Family finances — tended by Alex"
      centeredHeader
      className={`h-full ${className}`}
      footer={
        status === "ok" ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {summary?.updatedLabel ? `Balances as of ${summary.updatedLabel}` : "\u00A0"}
            </span>
            <Link href="/ledger" className="tap-sm widget-accent-text font-semibold">
              Open The Ledger {"\u2192"}
            </Link>
          </div>
        ) : undefined
      }
    >
      {status === "loading" && (
        <div className="flex flex-1 flex-col justify-center gap-3" aria-busy="true">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-white/10" />
          <div className="h-8 w-1/2 animate-pulse rounded-lg bg-white/10" />
          <div className="h-4 w-3/4 animate-pulse rounded-lg bg-white/5" />
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-text-secondary">The Ledger is unreachable right now.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="tap-sm rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-text-primary"
          >
            Try again
          </button>
        </div>
      )}
      {status === "ok" && summary && (
        <Link href="/ledger" className="tap group flex flex-1 flex-col justify-center gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Cash on hand</p>
            <p className="text-3xl font-bold tabular-nums text-text-primary">{formatUSD(summary.cash)}</p>
          </div>
          <div className="flex items-end justify-between gap-3 border-t border-white/10 pt-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">{summary.monthLabel}</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {formatUSD(summary.spent)}{" "}
                <span className="font-normal text-text-muted">of {formatUSD(summary.budgeted)}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Debt</p>
              <p className="text-sm font-semibold tabular-nums text-text-secondary">{formatUSD(summary.debt)}</p>
            </div>
          </div>
        </Link>
      )}
    </SectionCard>
  );
}
