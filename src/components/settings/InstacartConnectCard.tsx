"use client";

import { useState, useEffect } from "react";
import SoftButton from "@/components/ui/SoftButton";
import Surface from "@/components/ui/Surface";

export default function InstacartConnectCard() {
  const [status, setStatus] = useState<{ enabled: boolean; api_key_set: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/instacart/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ enabled: false, api_key_set: false });
    }
    setChecking(false);
  };

  const isEnabled = status?.enabled;
  const hasKey = status?.api_key_set;

  return (
    <div className="space-y-3">
      {/* Status */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🛒</span>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-text-primary">Instacart Grocery Delivery</h4>
          <p className="text-xs text-text-secondary">
            Turn meal plans into shoppable Instacart carts. Get delivery in 30-60 min.
          </p>
        </div>
        {isEnabled ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
            Connected
          </span>
        ) : hasKey ? (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-400">
            Partial
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-[var(--color-surface-3)] px-2.5 py-1 text-[11px] font-bold text-text-muted">
            Not configured
          </span>
        )}
      </div>

      {/* What it does */}
      <Surface variant="glass-subtle" radius="xl" padding="sm">
        <h4 className="text-xs font-bold text-text-primary mb-2">What Instacart integration enables:</h4>
        <ul className="space-y-1 text-xs text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>One-click &quot;Order Groceries&quot; buttons on meal plan cards</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Consuela AI can create shopping lists from natural language</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Recipe pages with pantry item detection (mark what you have)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Delivery from 1,800+ retailers (Kroger, Costco, Safeway, etc.)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">✓</span>
            <span>Kids see meal names with fun emojis (no ordering capability)</span>
          </li>
        </ul>
      </Surface>

      {/* Setup instructions */}
      {!isEnabled && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/40 px-3 py-3">
          <h4 className="text-xs font-bold text-text-primary mb-2">Setup (2 minutes):</h4>
          <ol className="space-y-1.5 text-xs text-text-secondary">
            <li className="flex items-start gap-2">
              <span className="font-bold text-text-muted shrink-0">1.</span>
              <span>
                Get an API key from{" "}
                <a href="https://docs.instacart.com/developer_platform_api/guide/get_api_key" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-selected)] underline">
                  Instacart Developer Portal
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-text-muted shrink-0">2.</span>
              <span>
                Add to your <code className="rounded bg-[var(--color-surface-3)] px-1 py-0.5 text-[10px]">.env.local</code>:
              </span>
            </li>
          </ol>
          <div className="mt-2 rounded-lg bg-[var(--color-surface-0)]/60 px-3 py-2 font-mono text-[10px] text-text-muted">
            <div>INSTACART_API_KEY=your_key_here</div>
            <div>NEXT_PUBLIC_INSTACART_ENABLED=true</div>
          </div>
          <SoftButton
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={checkStatus}
            loading={checking}
          >
            Check Connection
          </SoftButton>
        </div>
      )}

      {/* Enabled state */}
      {isEnabled && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <p className="text-xs text-emerald-300 font-semibold">
            ✅ Instacart is connected! Meal plan cards now have &quot;Order Delivery&quot; buttons.
          </p>
          <p className="text-[10px] text-text-muted mt-1">
            Try it: Go to Meals → Plan tab → click &quot;🛒 Order&quot; on any meal.
          </p>
        </div>
      )}
    </div>
  );
}
