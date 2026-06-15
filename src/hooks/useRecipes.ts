/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { Recipe } from "@/types/meals";
import { defaultRecipes } from "@/data/meals";

const RECIPES_KEY = "consuela-recipes";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

export function useRecipes(showToast: (msg: string) => void) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => {
    const saved = loadJSON(RECIPES_KEY, defaultRecipes);
    setRecipes(saved);
  }, []);

  useEffect(() => {
    if (recipes.length) localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  }, [recipes]);

  const saveCatalogRecipe = (recipe: Recipe) => {
    if (!recipe.name.trim()) return;
    const isExisting = recipes.some(r => r.id === recipe.id);
    if (isExisting) {
      setRecipes(prev => prev.map(r => r.id === recipe.id ? { ...recipe } : r));
      showToast(`✅ "${recipe.name}" updated!`);
    } else {
      const newRecipe = { ...recipe, id: Date.now(), createdAt: new Date().toISOString() };
      setRecipes(prev => [...prev, newRecipe]);
      showToast(`✅ "${newRecipe.name}" added!`);
    }
  };

  const deleteCatalogRecipe = (id: number) => {
    setRecipes(prev => prev.filter(r => r.id !== id));
    showToast(`🗑️ Recipe deleted.`);
  };

  const extractPdfText = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = async () => {
        try {
          const pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let text = "";
          for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((item: any) => item.str).join(" ") + "\n";
          }
          resolve(text);
        } catch { resolve(""); }
      };
      script.onerror = () => resolve("");
      document.head.appendChild(script);
    });
  };

  const handleFileUpload = async (file: File) => {
    showToast(`📄 Reading "${file.name}"...`);
    try {
      let text = "";
      if (file.name.endsWith(".pdf")) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }

      if (!text || text.length < 20) {
        showToast("❌ Could not extract text from file");
        return;
      }

      showToast("🤖 Asking Consuela to parse recipe...");
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Parse this recipe text into a structured recipe. Return as JSON: {"actions":[{"type":"recipe","title":"Recipe Name","detail":"Prep time · Ingredient1 · Ingredient2 · Ingredient3","emoji":"🍽️"}]}.\n\nRecipe text:\n${text.substring(0, 3000)}`,
        }),
      });
      const data = await res.json();
      const actions = data.actions || [];

      if (actions.length > 0 && actions[0].type === "recipe") {
        const a = actions[0];
        const ingredients = a.detail?.split("·").map((s: string) => s.trim()).filter(Boolean).filter((s: string) => !s.match(/\d+\s*min/i)) || [];
        const prepMatch = a.detail?.match(/(\d+\s*min)/);
        const newRecipe: Recipe = {
          id: Date.now(),
          name: a.title || file.name.replace(/\.\w+$/, ""),
          emoji: a.emoji || "📖",
          prepTime: prepMatch?.[1] || "30 min",
          tags: ["Imported"],
          ingredients,
          instructions: text.substring(0, 500),
          servings: 4,
          calories: 500,
          createdAt: new Date().toISOString(),
          source: file.name,
        };
        setRecipes(prev => [...prev, newRecipe]);
        showToast(`✅ Added "${newRecipe.name}" to recipe catalog`);
      } else {
        showToast("❌ Could not parse recipe. Try again or add manually.");
      }
    } catch (err) {
      showToast("❌ Error reading file");
    }
  };

  return {
    recipes,
    saveCatalogRecipe,
    deleteCatalogRecipe,
    handleFileUpload,
  };
}
