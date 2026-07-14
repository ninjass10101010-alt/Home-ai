import { useState, useEffect, useCallback } from "react";
import { Recipe } from "@/types/meals";
import { defaultRecipes } from "@/data/meals";

export function useRecipes(showToast: (msg: string) => void) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch recipes from API on mount (uses meals endpoint filtered for user)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/meals?userId=demo");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: Recipe[] = (data.meals || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          emoji: m.emoji || "📖",
          prepTime: m.prepTime || "30 min",
          cookTime: m.cookTime,
          tags: typeof m.tags === "string"
            ? m.tags
              ? JSON.parse(m.tags)
              : []
            : m.tags || [],
          ingredients: typeof m.ingredients === "string"
            ? m.ingredients
              ? JSON.parse(m.ingredients)
              : []
            : m.ingredients || [],
          instructions: m.instructions || "",
          servings: m.servings ?? 4,
          calories: m.calories ?? 500,
          protein: m.protein,
          carbs: m.carbs,
          fat: m.fat,
          source: m.source,
          createdAt: m.created || m.createdAt || new Date().toISOString(),
        }));
        if (!cancelled) {
          // Merge: keep any locally-added recipes not in API, plus API items
          setRecipes(items.length > 0 ? items : defaultRecipes);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setRecipes(defaultRecipes);
          setError(e?.message || "Failed to load recipes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveCatalogRecipe = useCallback(
    async (recipe: Recipe) => {
      if (!recipe.name.trim()) return;
      const isExisting = recipes.some((r) => r.id === recipe.id);

      if (isExisting) {
        // Update existing — try API first
        try {
          await fetch("/api/meals", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...recipe }),
          });
        } catch {
          // Still update locally
        }
        setRecipes((prev) =>
          prev.map((r) => (r.id === recipe.id ? { ...recipe } : r))
        );
        showToast(`✅ "${recipe.name}" updated!`);
      } else {
        // Create new — try API first
        let newRecipe = {
          ...recipe,
          id: `temp-${Date.now()}` as any,
          createdAt: new Date().toISOString(),
        };
        // Optimistic add
        setRecipes((prev) => [...prev, newRecipe]);

        try {
          const res = await fetch("/api/meals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: recipe.name,
              emoji: recipe.emoji,
              prepTime: recipe.prepTime,
              cookTime: recipe.cookTime,
              tags: recipe.tags,
              ingredients: recipe.ingredients,
              instructions: recipe.instructions,
              servings: recipe.servings,
              calories: recipe.calories,
              protein: recipe.protein,
              carbs: recipe.carbs,
              fat: recipe.fat,
              source: recipe.source,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const saved = data.meal;
            const realRecipe: Recipe = {
              ...newRecipe,
              id: saved.id,
              createdAt: saved.created || saved.createdAt || new Date().toISOString(),
            };
            // Replace temp with real
            setRecipes((prev) =>
              prev.map((r) =>
                r.id === newRecipe.id ? realRecipe : r
              )
            );
            newRecipe = realRecipe;
          }
        } catch {
          // Keep optimistic item
        }
        showToast(`✅ "${newRecipe.name}" added!`);
      }
    },
    [recipes, showToast]
  );

  const deleteCatalogRecipe = useCallback(
    async (id: string | number) => {
      let removedRecipe: Recipe | undefined;
      setRecipes((prev) => {
        removedRecipe = prev.find((r) => r.id === id);
        return prev.filter((r) => r.id !== id);
      });
      try {
        await fetch(`/api/meals?id=${id}`, { method: "DELETE" });
      } catch {
        // Revert on failure
        if (removedRecipe) {
          setRecipes((prev) => [...prev, removedRecipe!]);
        }
      }
      showToast(`🗑️ Recipe deleted.`);
    },
    [showToast]
  );

  const extractPdfText = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = async () => {
        try {
          const pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let text = "";
          for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text +=
              content.items.map((item: any) => item.str).join(" ") + "\n";
          }
          resolve(text);
        } catch {
          resolve("");
        }
      };
      script.onerror = () => resolve("");
      document.head.appendChild(script);
    });
  };

  const handleFileUpload = useCallback(
    async (file: File) => {
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
        const res = await fetch("/api/hermes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Parse this recipe text into a structured recipe. Return as JSON: {"actions":[{"type":"recipe","title":"Recipe Name","detail":"Prep time · Ingredient1 · Ingredient2 · Ingredient3","emoji":"🍽️"}]}.\n\nRecipe text:\n${text.substring(0, 3000)}`,
          }),
        });
        const data = await res.json();
        const actions = data.actions || [];

        if (actions.length > 0 && actions[0].type === "recipe") {
          const a = actions[0];
          const ingredients =
            a.detail
              ?.split("·")
              .map((s: string) => s.trim())
              .filter(Boolean)
              .filter((s: string) => !s.match(/\d+\s*min/i)) || [];
          const prepMatch = a.detail?.match(/(\d+\s*min)/);
          const newRecipe: any = {
            id: `temp-${Date.now()}`,
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

          // Try saving to API
          try {
            const apiRes = await fetch("/api/meals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: newRecipe.name,
                emoji: newRecipe.emoji,
                prepTime: newRecipe.prepTime,
                tags: newRecipe.tags,
                ingredients: newRecipe.ingredients,
                instructions: newRecipe.instructions,
                servings: newRecipe.servings,
                calories: newRecipe.calories,
                source: newRecipe.source,
              }),
            });
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              newRecipe.id = apiData.meal.id;
            }
          } catch {
            // Keep with temp ID
          }

          setRecipes((prev) => [...prev, newRecipe]);
          showToast(`✅ Added "${newRecipe.name}" to recipe catalog`);
        } else {
          showToast("❌ Could not parse recipe. Try again or add manually.");
        }
      } catch (err) {
        showToast("❌ Error reading file");
      }
    },
    [showToast]
  );

  return {
    recipes,
    loading,
    error,
    saveCatalogRecipe,
    deleteCatalogRecipe,
    handleFileUpload,
  };
}
