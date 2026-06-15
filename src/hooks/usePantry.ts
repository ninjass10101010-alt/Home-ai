/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { db } from "@/db";
import { PantryItem } from "@/types/meals";

const PANTRY_KEY = "consuela-pantry";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

export function usePantry(showToast: (msg: string) => void) {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);

  useEffect(() => {
    const pantry = db.selectPantry().map((p: any) => ({ id: p.id, item: p.name, status: p.status }));
    const savedPantry = loadJSON(PANTRY_KEY, pantry.length ? pantry : []);
    setPantryItems(savedPantry);
  }, []);

  useEffect(() => {
    if (pantryItems.length) localStorage.setItem(PANTRY_KEY, JSON.stringify(pantryItems));
  }, [pantryItems]);

  const addPantryItem = (name: string, status: "plenty" | "low" | "out") => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = pantryItems.some(p => p.item.toLowerCase() === trimmed.toLowerCase());
    if (exists) { showToast("Item already in pantry"); return false; }
    const saved = db.upsertPantryItem({ userId: "demo", name: trimmed, status });
    setPantryItems(prev => [...prev, { id: saved.id, item: saved.name, status: saved.status }]);
    showToast(`🥫 Added ${trimmed} to pantry`);
    return true;
  };

  const updatePantryStatus = (id: number, status: "plenty" | "low" | "out") => {
    const item = pantryItems.find(p => p.id === id);
    if (!item) return;
    db.upsertPantryItem({ userId: "demo", name: item.item, status });
    setPantryItems(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  };

  const removePantryItem = (id: number) => {
    setPantryItems(prev => prev.filter(p => p.id !== id));
  };

  return {
    pantryItems,
    addPantryItem,
    updatePantryStatus,
    removePantryItem,
  };
}
