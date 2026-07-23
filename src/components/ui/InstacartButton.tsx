"use client";

import { useState } from "react";

interface InstacartButtonProps {
  title: string;
  ingredients: string[];
  variant?: "full" | "icon";
  className?: string;
}

/**
 * InstacartButton — Renders a "Order from Instacart" button that creates
 * a shopping list page on Instacart Marketplace.
 *
 * When clicked:
 *   1. POSTs to /api/instacart with the meal title + ingredients
 *   2. Opens the returned Instacart URL in a new tab
 *   3. Shows a brief "Opening Instacart..." toast
 */
export default function InstacartButton({ title, ingredients, variant = "full", className = "" }: InstacartButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/instacart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shopping_list",
          title: `${title} — Groceries`,
          ingredients,
        }),
      });

      const data = await res.json();

      if (data.success && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else if (!data.success && data.error?.includes("not enabled")) {
        // Instacart not configured — open Instacart search instead
        const searchQuery = ingredients.join(", ");
        window.open(
          `https://www.instacart.com/store/search?query=${encodeURIComponent(searchQuery)}`,
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        setError(data.error || "Could not create Instacart list");
      }
    } catch {
      // Network error — fallback to Instacart search
      const searchQuery = ingredients.join(", ");
      window.open(
        `https://www.instacart.com/store/search?query=${encodeURIComponent(searchQuery)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      setLoading(false);
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className={`grid h-11 w-11 place-items-center rounded-full tap disabled:opacity-50 ${className}`}
        style={{
          background: "rgba(255, 130, 0, 0.15)",
          border: "1px solid rgba(255, 130, 0, 0.3)",
        }}
        aria-label={`Order ${title} ingredients from Instacart`}
        title="Order from Instacart"
      >
        <span className="text-lg">{loading ? "⏳" : "🛒"}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold tap disabled:opacity-50 transition-all ${className}`}
        style={{
          background: "linear-gradient(135deg, rgba(255, 130, 0, 0.15), rgba(255, 130, 0, 0.05))",
          border: "1px solid rgba(255, 130, 0, 0.25)",
          color: "#ff8200",
        }}
        aria-label={`Order ${title} ingredients from Instacart`}
      >
        <span>{loading ? "⏳" : "🛒"}</span>
        <span>{loading ? "Opening..." : "Order Delivery"}</span>
      </button>
      {error && (
        <p className="mt-1 text-[10px] text-rose-400">{error}</p>
      )}
    </div>
  );
}
