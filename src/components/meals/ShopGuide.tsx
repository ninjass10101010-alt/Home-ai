"use client";
import { useSyncExternalStore } from "react";

export interface ShopGuideProps {
  /** Show the guide expanded by default (a saved preference wins over this). Default false. */
  defaultOpen?: boolean;
}

const COLLAPSE_KEY = "consuela-shop-guide-collapsed";
const COLLAPSE_EVENT = "consuela-shop-guide-collapsed-changed";

const SECTIONS: { icon: string; title: string; description: string }[] = [
  {
    icon: "🛒",
    title: "Add items",
    description:
      "Type an item above (like '2 bananas'), or tap '🍽️ Add missing from meal plan' to sync from your planned meals.",
  },
  {
    icon: "🏪",
    title: "Assign stores",
    description:
      "Tap the colored store pill next to any item to change which store it comes from. Six pinned stores plus more.",
  },
  {
    icon: "💰",
    title: "Compare prices",
    description:
      "Tap '💰 Compare Prices' to see per-store totals once you've assigned stores. The cheapest split is highlighted.",
  },
  {
    icon: "📤",
    title: "Order",
    description:
      "Tap '📤 Order from Instacart' to send your list to Instacart. Each store gets its own cart. Walmart uses walmart.com.",
  },
  {
    icon: "🤖",
    title: "Ask Clem",
    description:
      "Tap the 🛒 floating button at the bottom right to ask Clem — our AI grocery assistant.",
  },
];

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(COLLAPSE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(COLLAPSE_EVENT, onStoreChange);
  };
}

function getSnapshot(): "true" | "false" | null {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    return v === "true" || v === "false" ? v : null;
  } catch {
    return null;
  }
}

const getServerSnapshot = () => null;

export default function ShopGuide({ defaultOpen = false }: ShopGuideProps) {
  // localStorage is the external store: SSR/hydration see `null` (fall back to
  // defaultOpen), then the saved preference lands post-mount with no mismatch.
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = stored === null ? !defaultOpen : stored === "true";

  const toggle = () => {
    const next = !collapsed;
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      /* storage unavailable — in-memory toggle still applies */
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };

  return (
    <div className="glass rounded-2xl">
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="shop-guide-sections"
        className="tap-sm flex w-full items-center justify-between px-5 py-4"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-text-primary">
          <span aria-hidden>ℹ️</span> How to use your grocery list
        </span>
        <svg
          aria-hidden
          className={`h-4 w-4 text-text-secondary transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <ul id="shop-guide-sections" className="border-t border-white/10">
          {SECTIONS.map((section) => (
            <li key={section.title} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden className="text-xl shrink-0">
                {section.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{section.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{section.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
