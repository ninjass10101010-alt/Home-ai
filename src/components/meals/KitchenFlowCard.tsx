"use client";
import { useState, useSyncExternalStore } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

export type KitchenStep = "plan" | "shop" | "stock";

const STEPS: { id: KitchenStep; label: string; emoji: string }[] = [
  { id: "plan", label: "Plan", emoji: "🍽️" },
  { id: "shop", label: "Shop", emoji: "🛒" },
  { id: "stock", label: "Stock", emoji: "🥫" },
];

const STEP_SENTENCE: Record<KitchenStep, string> = {
  plan: "Pick this week's meals — missing ingredients become your shopping list.",
  shop: "Check items off as you buy them — bought items move into your pantry.",
  stock: "Track what you have — items running low go back on the shopping list.",
};

const STEP_TONE: Record<KitchenStep, string> = {
  plan: "#10b981",
  shop: "#3b82f6",
  stock: "#f59e0b",
};

const COLLAPSE_KEY = "consuela-kitchen-flow-collapsed";

const subscribeNoop = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

export default function KitchenFlowCard({ step, summary }: { step: KitchenStep; summary: string }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const mounted = useSyncExternalStore(subscribeNoop, clientTrue, serverFalse);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* no storage */ }
      return next;
    });
  };

  const active = STEPS.find(s => s.id === step) ?? STEPS[0];

  return (
    <WidgetCard tone={STEP_TONE[step]} icon={active.emoji} className="p-5 pl-[72px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Kitchen flow">
          {STEPS.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-xs text-text-muted">→</span>}
              <span
                aria-current={s.id === step ? "step" : undefined}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${
                  s.id === step
                    ? "bg-[var(--color-accent-button)] text-white"
                    : "bg-[var(--color-surface-2)] text-text-muted"
                }`}
              >
                {s.emoji} {s.label}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand kitchen flow card" : "Collapse kitchen flow card"}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-text-muted hover:text-text-primary tap-sm"
        >
          {mounted && collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {(!mounted || !collapsed) && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-text-primary">{STEP_SENTENCE[step]}</p>
          <p className="mt-1 text-xs font-bold text-text-secondary">{summary}</p>
        </div>
      )}
    </WidgetCard>
  );
}
