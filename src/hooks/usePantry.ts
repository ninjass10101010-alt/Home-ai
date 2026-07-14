import { useState, useEffect, useCallback } from "react";
import { PantryItem } from "@/types/meals";

export function usePantry(showToast: (msg: string) => void) {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch pantry items from API on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/pantry");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: PantryItem[] = (data.pantry || []).map((p: any) => ({
          id: p.id,
          item: p.name,
          status: p.status || "plenty",
        }));
        if (!cancelled) {
          setPantryItems(items);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setPantryItems([]);
          setError(e?.message || "Failed to load pantry");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addPantryItem = useCallback(
    async (name: string, status: "plenty" | "low" | "out") => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const exists = pantryItems.some(
        (p) => p.item.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) {
        showToast("Item already in pantry");
        return false;
      }
      try {
        const res = await fetch("/api/pantry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, status }),
        });
        if (res.ok) {
          const data = await res.json();
          const saved = data.item;
          setPantryItems((prev) => [
            ...prev,
            { id: saved.id, item: saved.name, status: saved.status },
          ]);
          showToast(`🥫 Added ${trimmed} to pantry`);
          return true;
        }
      } catch {
        // Still add optimistically
      }
      // Fallback: add locally even if API fails
      setPantryItems((prev) => [
        ...prev,
        { id: `temp-${Date.now()}`, item: trimmed, status } as any,
      ]);
      showToast(`🥫 Added ${trimmed} to pantry`);
      return true;
    },
    [pantryItems, showToast]
  );

  const updatePantryStatus = useCallback(
    async (id: string | number, status: "plenty" | "low" | "out") => {
      const item = pantryItems.find((p) => p.id === id);
      if (!item) return;
      // Optimistic update
      setPantryItems((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status } : p))
      );
      try {
        await fetch("/api/pantry", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
      } catch {
        // Revert on failure
        setPantryItems((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: item.status } : p))
        );
      }
    },
    [pantryItems]
  );

  const removePantryItem = useCallback(async (id: string | number) => {
    let removedItem: PantryItem | undefined;
    setPantryItems((prev) => {
      removedItem = prev.find((p) => p.id === id);
      return prev.filter((p) => p.id !== id);
    });
    try {
      await fetch(`/api/pantry?id=${id}`, { method: "DELETE" });
    } catch {
      // Revert on failure
      if (removedItem) {
        setPantryItems((prev) => [...prev, removedItem!]);
      }
    }
  }, []);

  return {
    pantryItems,
    loading,
    error,
    addPantryItem,
    updatePantryStatus,
    removePantryItem,
  };
}
