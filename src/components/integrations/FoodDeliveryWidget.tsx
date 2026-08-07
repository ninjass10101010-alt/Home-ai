/**
 * FoodDeliveryWidget — "No plans for dinner?" one-tap food delivery.
 *
 * Shows when there's no meal planned for today. Offers cuisine-based
 * quick links to DoorDash/Uber Eats for ordering.
 *
 * Requires: DoorDash connected via Settings → Connections.
 */
"use client";

import { useState, useEffect } from "react";
import Surface from "@/components/ui/Surface";
import { isConnected } from "@/lib/connections/store";

const CUISINES = [
  { emoji: "🍕", label: "Pizza", query: "pizza near me" },
  { emoji: "🌮", label: "Mexican", query: "mexican food near me" },
  { emoji: "🍣", label: "Sushi", query: "sushi near me" },
  { emoji: "🍔", label: "Burgers", query: "burgers near me" },
  { emoji: "🥗", label: "Healthy", query: "healthy food near me" },
  { emoji: "🍜", label: "Asian", query: "asian food near me" },
  { emoji: "🍝", label: "Italian", query: "italian food near me" },
  { emoji: "🥡", label: "Chinese", query: "chinese food near me" },
];

export default function FoodDeliveryWidget() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isConnected("doordash"));
  }, []);

  if (!enabled) return null;

  const openDoorDash = (query: string) => {
    // Deep link to DoorDash search
    window.open(
      `https://www.doordash.com/search?query=${encodeURIComponent(query)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Surface variant="warm" radius="2xl" padding="none">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">🍽️</span>
          <div className="flex-1">
            <h3 className="text-base font-bold text-text-primary">No Dinner Plans?</h3>
            <p className="text-xs text-text-secondary mt-0.5">Order from local restaurants in minutes</p>
          </div>
        </div>

        {/* Cuisine grid */}
        <div className="grid grid-cols-4 gap-2">
          {CUISINES.map((cuisine) => (
            <button
              key={cuisine.label}
              onClick={() => openDoorDash(cuisine.query)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl tap"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span className="text-2xl">{cuisine.emoji}</span>
              <span className="text-[10px] font-bold text-text-secondary">{cuisine.label}</span>
            </button>
          ))}
        </div>

        {/* Also try Instacart */}
        <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
          <span className="text-xs text-text-muted">Or cook at home?</span>
          <a
            href="/meals?tab=grocery"
            className="text-xs font-semibold text-[var(--color-accent-selected)] hover:underline"
          >
            🛒 Order groceries →
          </a>
        </div>
      </div>
    </Surface>
  );
}
