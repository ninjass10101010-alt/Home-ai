/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { db } from "@/db";
import { GroceryItem, PantryItem } from "@/types/meals";

const PANTRY_KEY = "consuela-pantry";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

const mergePantryWithDb = (saved: PantryItem[], current: any[]) => {
  const merged = [...saved];
  current.forEach((item: any) => {
    const id = Number(item.id);
    const existing = merged.find(p => p.id === id || normalizeName(p.item) === normalizeName(item.name || item.item));
    const normalized = { id, item: item.name || item.item, status: item.status || "plenty" };
    if (existing) Object.assign(existing, normalized);
    else merged.push(normalized);
  });
  return merged;
};

export function usePantry(showToast: (msg: string) => void, groceryItems: GroceryItem[] = []) {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);

  useEffect(() => {
    const local = loadJSON<PantryItem[]>(PANTRY_KEY, []);
    const pbData = db.selectPantry().map((p: any) => ({ id: p.id, item: p.name || p.item, status: p.status }));
    if (pbData.length > 0) {
      const merged = [...pbData];
      const pbIds = new Set(pbData.map(p => p.id));
      const pbNames = new Set(pbData.map(p => normalizeName(p.item)));
      for (const item of local) {
        if (!pbIds.has(item.id) && !pbNames.has(normalizeName(item.item))) {
          merged.push(item);
        }
      }
      setPantryItems(merged);
    } else {
      setPantryItems(local.length > 0 ? local : pbData);
    }
  }, []);

  useEffect(() => {
    if (pantryItems.length) localStorage.setItem(PANTRY_KEY, JSON.stringify(pantryItems));
  }, [pantryItems]);

  const addPantryItem = async (name: string, status: "plenty" | "low" | "out") => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const exists = pantryItems.some(p => normalizeName(p.item) === normalizeName(trimmed));
    if (exists) { showToast("Item already in pantry"); return false; }
    const alreadyOnGrocery = groceryItems.some(g => normalizeName(g.name) === normalizeName(trimmed) && g.needed);
    const saved = await db.upsertPantryItem({ userId: "demo", name: trimmed, status });
    setPantryItems(prev => [...prev, { id: saved.id, item: saved.name || saved.item, status: saved.status }]);
    showToast(alreadyOnGrocery ? `🥫 Added ${trimmed} to pantry and grocery` : `🥫 Added ${trimmed} to pantry`);
    return true;
  };

  const updatePantryStatus = async (id: number, status: "plenty" | "low" | "out") => {
    const item = pantryItems.find(p => p.id === id);
    if (!item) return;
    await db.upsertPantryItem({ userId: "demo", name: item.item, status });
    setPantryItems(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  };

  const removePantryItem = async (id: number) => {
    await db.deletePantryItem(id);
    setPantryItems(prev => prev.filter(p => p.id !== id));
  };

  return {
    pantryItems,
    addPantryItem,
    updatePantryStatus,
    removePantryItem,
  };
}
