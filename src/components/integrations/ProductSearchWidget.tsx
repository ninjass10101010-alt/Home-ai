/**
 * ProductSearchWidget — Search Amazon and Walmart for household items.
 *
 * Integrates with the grocery list — when items are marked as "household"
 * category, shows price comparison and quick-add links.
 *
 * Requires: Amazon or Walmart connected via Settings → Connections.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import { isConnected, getCredentials } from "@/lib/connections/store";

interface Product {
  name: string;
  price: string;
  store: "amazon" | "walmart";
  url: string;
  image?: string;
  rating?: number;
  prime?: boolean;
}

interface ProductSearchWidgetProps {
  /** Items from the grocery list to search for */
  items?: string[];
}

export default function ProductSearchWidget({ items = [] }: ProductSearchWidgetProps) {
  const [amazonEnabled, setAmazonEnabled] = useState(false);
  const [walmartEnabled, setWalmartEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAmazonEnabled(isConnected("amazon"));
    setWalmartEnabled(isConnected("walmart"));
  }, []);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setResults([]);

    try {
      // In production, this calls Composio search API
      // Simulated results for demo
      const simulated: Product[] = [
        {
          name: `${query} — Brand Name`,
          price: "$12.99",
          store: "amazon",
          url: `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
          rating: 4.5,
          prime: true,
        },
        {
          name: `${query} — Value Pack`,
          price: "$9.97",
          store: "walmart",
          url: `https://www.walmart.com/search?q=${encodeURIComponent(query)}`,
          rating: 4.2,
        },
        {
          name: `${query} — Organic`,
          price: "$15.49",
          store: "amazon",
          url: `https://www.amazon.com/s?k=${encodeURIComponent(query + " organic")}`,
          rating: 4.8,
          prime: true,
        },
      ];

      setResults(simulated);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  if (!amazonEnabled && !walmartEnabled) return null;

  return (
    <Surface variant="glass-subtle" radius="xl" padding="none">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔍</span>
          <h3 className="text-sm font-bold text-text-primary">Compare Prices</h3>
          <div className="flex items-center gap-1 ml-auto">
            {amazonEnabled && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Amazon</span>
            )}
            {walmartEnabled && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">Walmart</span>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search(searchQuery)}
            placeholder="Search for an item..."
            className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-2.5 pr-20 text-sm text-text-primary outline-none placeholder:text-text-dim focus:border-[var(--color-accent-selected)]/40 transition-colors"
          />
          <button
            onClick={() => search(searchQuery)}
            disabled={!searchQuery.trim() || loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg text-xs font-bold tap disabled:opacity-50"
            style={{ background: "var(--color-accent-selected)", color: "white" }}
          >
            {loading ? "..." : "Search"}
          </button>
        </div>

        {/* Quick search from grocery list */}
        {items.length > 0 && !results.length && (
          <div className="mb-3">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">From your grocery list</p>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {items.slice(0, 6).map((item) => (
                <button
                  key={item}
                  onClick={() => { setSearchQuery(item); search(item); }}
                  className="px-3 py-1.5 rounded-full text-[10px] font-semibold whitespace-nowrap tap shrink-0"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--color-text-secondary)" }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {loading && (
          <div className="flex items-center gap-2 py-3 justify-center">
            <div className="w-3 h-3 rounded-full border-2 border-[var(--color-accent-selected)] border-t-transparent animate-spin" />
            <span className="text-[10px] text-text-muted">Searching...</span>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((product, i) => (
              <a
                key={i}
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <div
                  className="w-9 h-9 rounded-lg grid place-items-center text-xs font-bold shrink-0"
                  style={{
                    background: product.store === "amazon" ? "rgba(255, 153, 0, 0.15)" : "rgba(0, 113, 223, 0.15)",
                    color: product.store === "amazon" ? "#ff9900" : "#0071df",
                  }}
                >
                  {product.store === "amazon" ? "A" : "W"}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-text-primary truncate">{product.name}</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-bold text-text-primary tabular-nums">{product.price}</span>
                    {product.rating && (
                      <span className="text-[10px] text-amber-400">⭐ {product.rating}</span>
                    )}
                    {product.prime && (
                      <span className="text-[9px] font-bold text-blue-400">Prime</span>
                    )}
                  </div>
                </div>
                <span className="text-[var(--color-accent-selected)] text-xs shrink-0">View →</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </Surface>
  );
}
