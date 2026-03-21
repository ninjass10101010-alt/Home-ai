"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";

interface Meal {
  id: number;
  name: string;
  emoji: string;
  time: string;
  prepTime: string;
  tags: string[];
  ingredients: string[];
  servings: number;
  calories: number;
}

const mealDb: Meal[] = [
  {
    id: 1,
    name: "Pasta Primavera",
    emoji: "🍝",
    time: "Mon",
    prepTime: "25 min",
    tags: ["Vegetarian", "Quick"],
    ingredients: ["Penne pasta", "Zucchini", "Bell peppers", "Parmesan", "Olive oil"],
    servings: 4,
    calories: 420,
  },
  {
    id: 2,
    name: "Taco Night",
    emoji: "🌮",
    time: "Tue",
    prepTime: "20 min",
    tags: ["Family Fave", "Quick"],
    ingredients: ["Ground beef", "Taco shells", "Salsa", "Sour cream", "Lettuce", "Cheese"],
    servings: 4,
    calories: 550,
  },
  {
    id: 3,
    name: "Grilled Chicken",
    emoji: "🍗",
    time: "Wed",
    prepTime: "35 min",
    tags: ["High Protein", "Healthy"],
    ingredients: ["Chicken breast", "Broccoli", "Lemon", "Garlic", "Olive oil"],
    servings: 4,
    calories: 380,
  },
  {
    id: 4,
    name: "Shrimp Stir Fry",
    emoji: "🥢",
    time: "Thu",
    prepTime: "20 min",
    tags: ["Seafood", "Quick"],
    ingredients: ["Shrimp", "Snap peas", "Carrots", "Soy sauce", "Ginger", "Rice"],
    servings: 4,
    calories: 410,
  },
  {
    id: 5,
    name: "Homemade Pizza",
    emoji: "🍕",
    time: "Fri",
    prepTime: "45 min",
    tags: ["Family Fave", "Fun"],
    ingredients: ["Pizza dough", "Mozzarella", "Tomato sauce", "Bell peppers", "Mushrooms"],
    servings: 4,
    calories: 620,
  },
  {
    id: 6,
    name: "BBQ Ribs",
    emoji: "🍖",
    time: "Sat",
    prepTime: "2 hr",
    tags: ["Weekend", "Indulgent"],
    ingredients: ["Pork ribs", "BBQ sauce", "Corn on cob", "Coleslaw"],
    servings: 4,
    calories: 780,
  },
  {
    id: 7,
    name: "Slow Cooker Chili",
    emoji: "🫕",
    time: "Sun",
    prepTime: "6 hr",
    tags: ["Comfort Food", "Meal Prep"],
    ingredients: ["Ground beef", "Kidney beans", "Tomatoes", "Chili powder", "Onion"],
    servings: 6,
    calories: 490,
  },
];

const mealIdeas = [
  { name: "Salmon & Asparagus", emoji: "🐟", tags: ["Healthy"] },
  { name: "Veggie Curry", emoji: "🍛", tags: ["Vegetarian"] },
  { name: "BLT Sandwiches", emoji: "🥪", tags: ["Quick"] },
  { name: "Mac & Cheese", emoji: "🧀", tags: ["Kids Love"] },
];

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MealsPage() {
  const [activeDay, setActiveDay] = useState("Tue");
  const [showNutrition, setShowNutrition] = useState(false);

  const activeMeal = mealDb.find((m) => m.time === activeDay);

  // Function to import recipe from URL
  const importRecipeFromUrl = (url: string, source: string) => {
    // In a real implementation, this would:
    // 1. Fetch the URL content
    // 2. Parse the recipe data based on the source
    // 3. Extract ingredients, instructions, etc.
    // 4. Add to meal database or show preview
    
    // For now, we'll simulate with a mock response
    alert(`Importing recipe from ${source}:\n${url}\n\nIn a real implementation, this would parse the URL and extract the recipe data.`);
    
    // Example of what parsed data might look like:
    const mockRecipe = {
      name: "Imported Recipe",
      emoji: "🍳",
      time: "Today",
      prepTime: "30 min",
      tags: ["Imported"],
      ingredients: ["Ingredient 1", "Ingredient 2", "Ingredient 3"],
      servings: 4,
      calories: 350
    };
    
    // In a real app, we might add this to our meal database or show a preview
    console.log("Parsed recipe:", mockRecipe);
  };

  // Function to handle file upload (text-based recipes)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      // In a real implementation, parse the content based on file type
      // For now, just show the content
      alert(`File content:\n${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n\nIn a real implementation, this would parse the recipe data.`);
    };
    reader.readAsText(file);
    
    // Reset input to allow same file upload again
    e.target.value = '';
  };

  // Function to handle PDF upload
  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // In a real implementation, we would use a PDF parsing library
    // like pdf.js or pdftotext to extract text from the PDF
    alert(`PDF file selected: ${file.name}\n\nIn a real implementation, this would extract text from the PDF and parse the recipe data.`);
    
    // Reset input to allow same file upload again
    e.target.value = '';
  };

  return (
    <PageShell>
      <TopBar
        title="Meal Planner"
        subtitle="This week"
        right={
          <Link
            href="/chat?q=Plan+meals+for+this+week"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-nori-500/15 text-nori-400 text-xs font-medium hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M12 2l2 7h7l-5.7 4.1 2.2 6.9L12 16l-5.5 4 2.2-6.9L3 9h7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            AI Suggest
          </Link>
        }
      />

      <div className="px-4 space-y-5">
        {/* Weekly overview strip */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {weekDays.map((day) => {
            const meal = mealDb.find((m) => m.time === day);
            const isActive = day === activeDay;
            return (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className={`shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-all active:scale-95 ${
                  isActive
                    ? "bg-nori-500/15 border border-nori-500/25"
                    : "glass border border-transparent hover:border-surface-4"
                }`}
              >
                <span className={`text-xs font-medium ${isActive ? "text-nori-400" : "text-text-secondary"}`}>
                  {day}
                </span>
                <span className="text-2xl">{meal?.emoji ?? "➕"}</span>
                <span className="text-[10px] text-text-muted text-center leading-tight w-full truncate">
                  {meal?.name ?? "Add meal"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active meal detail */}
        {activeMeal && (
          <Card glow>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center text-3xl shrink-0">
                {activeMeal.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-text-primary font-bold text-lg leading-tight">{activeMeal.name}</h2>
                <p className="text-text-secondary text-xs mt-1">{activeMeal.prepTime} · {activeMeal.servings} servings</p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {activeMeal.tags.map((t) => (
                    <Badge key={t} variant="green">{t}</Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Nutrition toggle */}
            <button
              onClick={() => setShowNutrition(!showNutrition)}
              className="w-full flex items-center justify-between py-2 border-t border-surface-3 text-text-secondary text-xs hover:text-text-primary transition-colors"
            >
              <span>Nutrition info</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`w-4 h-4 transition-transform ${showNutrition ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {showNutrition && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { label: "Calories", value: activeMeal.calories.toString(), unit: "kcal" },
                  { label: "Protein", value: "32", unit: "g" },
                  { label: "Carbs", value: "48", unit: "g" },
                ].map((n) => (
                  <div key={n.label} className="bg-surface-2 rounded-xl p-2.5 text-center">
                    <p className="text-text-primary font-bold text-base">{n.value}</p>
                    <p className="text-[10px] text-text-muted">{n.unit} {n.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Ingredients */}
            <div className="mt-4">
              <p className="text-text-secondary text-xs font-medium mb-2">Ingredients</p>
              <div className="flex flex-wrap gap-1.5">
                {activeMeal.ingredients.map((ing) => (
                  <span
                    key={ing}
                    className="px-2.5 py-1 rounded-lg bg-surface-2 text-text-secondary text-xs"
                  >
                    {ing}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <Link
                href="/grocery"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-nori-500/15 text-nori-400 text-sm font-medium hover:bg-nori-500/25 transition-colors"
              >
                🛒 Add to grocery
              </Link>
              <Link
                href="/chat?q=Change+dinner+for+Tuesday"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass text-text-secondary text-sm font-medium hover:text-text-primary transition-colors"
              >
                🔄 Change meal
              </Link>
            </div>
          </Card>
        )}

        {/* AI Suggestions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-semibold text-sm">Consuela Suggests</h3>
            <Badge variant="violet">✨ AI picks</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {mealIdeas.map((idea) => (
              <Card key={idea.name} onClick={() => {}} className="!p-3">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="text-2xl">{idea.emoji}</span>
                  <p className="text-text-primary text-xs font-medium leading-tight">{idea.name}</p>
                  <div className="flex gap-1 flex-wrap justify-center">
                    {idea.tags.map((t) => (
                      <Badge key={t} variant="gray">{t}</Badge>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Pantry status */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-semibold text-sm">Pantry Check</h3>
            <Link href="/chat?q=What+can+I+make+with+pantry+items" className="text-nori-400 text-xs hover:text-nori-300">
              Ask Consuela →
            </Link>
          </div>
          <Card className="!p-3">
            <div className="space-y-2.5">
              {[
                { item: "Chicken breast", status: "plenty", color: "green" },
                { item: "Pasta", status: "low", color: "amber" },
                { item: "Olive oil", status: "plenty", color: "green" },
                { item: "Tomato sauce", status: "out", color: "rose" },
              ].map((p) => (
                <div key={p.item} className="flex items-center justify-between">
                  <span className="text-text-primary text-sm">{p.item}</span>
                  <Badge variant={p.color as "green" | "amber" | "rose"}>{p.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* Recipe Import */}
        <section className="pb-2">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Import Recipes</h3>
          <div className="space-y-4">
            {/* URL-based imports for Pinterest/TikTok */}
            <div className="space-y-3">
              <h4 className="text-text-secondary text-sm font-medium mb-1">From URL</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all bg-nori-500/15 text-nori-400 border border-nori-500/20 hover:bg-nori-500/25"
                  onClick={() => {
                    const url = prompt("Enter Pinterest URL:");
                    if (url) {
                      importRecipeFromUrl(url, "pinterest");
                    }
                  }}
                >
                  📌 Pinterest
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all bg-nori-500/15 text-nori-400 border border-nori-500/20 hover:bg-nori-500/25"
                  onClick={() => {
                    const url = prompt("Enter TikTok URL:");
                    if (url) {
                      importRecipeFromUrl(url, "tiktok");
                    }
                  }}
                >
                  🎵 TikTok
                </button>
              </div>
            </div>
            
            {/* File upload for browser/PDF */}
            <div className="space-y-3">
              <h4 className="text-text-secondary text-sm font-medium mb-1">From File</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all bg-nori-500/15 text-nori-400 border border-nori-500/20 hover:bg-nori-500/25"
                  onClick={() => {
                    document.getElementById("file-upload")?.click();
                  }}
                >
                  🌐 Browser
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all bg-nori-500/15 text-nori-400 border border-nori-500/20 hover:bg-nori-500/25"
                  onClick={() => {
                    document.getElementById("pdf-upload")?.click();
                  }}
                >
                  📄 PDF
                </button>
                {/* Hidden file inputs */}
                <input
                  type="file"
                  id="file-upload"
                  accept=".txt,.json,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <input
                  type="file"
                  id="pdf-upload"
                  accept=".pdf"
                  className="hidden"
                  onChange={handlePdfUpload}
                />
              </div>
            </div>
          </div>
          <p className="text-text-muted text-xs mt-2">
            Save recipes from your favorite apps and websites directly to your meal planner
          </p>
        </section>

        {/* Dietary preferences */}
        <section className="pb-2">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Family Preferences</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "🥦 Vegetarian options", active: true },
              { label: "🐟 Seafood twice/week", active: true },
              { label: "🌶️ Not too spicy", active: true },
              { label: "🥜 Nut-free (Lily)", active: true },
              { label: "🍖 Low-carb", active: false },
            ].map((pref) => (
              <span
                key={pref.label}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  pref.active
                    ? "bg-nori-500/15 text-nori-400 border border-nori-500/20"
                    : "glass text-text-muted border border-surface-3"
                }`}
              >
                {pref.label}
              </span>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
