import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

function isPrivateIP(hostname: string): boolean {
  if (!hostname) return true;
  if (/localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0/.test(hostname)) return true;
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipMatch) return false;
  const [, a, b] = ipMatch.map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function cleanExtractedText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

async function fetchAndExtract(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (isPrivateIP(parsed.hostname)) {
    throw new Error("Private network URLs are not allowed");
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Consuela-Dashboard/1.0 RecipeImporter",
      Accept: "text/html,application/xhtml+xml,*/*",
    },
    signal: AbortSignal.timeout(15000),
  });

  const html = await res.text();

  const ldJson = html.match(/<script\s+[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldJson) {
    try {
      const json = JSON.parse(ldJson[1]);
      if (Array.isArray(json)) {
        const recipe = json.find((item: any) => item["@type"] === "Recipe");
        if (recipe) return formatSchemaRecipeToText(recipe);
      }
      if (json["@type"] === "Recipe") {
        return formatSchemaRecipeToText(json);
      }
    } catch {
      // keep going with Readability
    }
  }

  const { document } = parseHTML(html);
  const reader = new Readability(document.cloneNode(true) as any);
  const article = reader.parse();
  return cleanExtractedText(article?.textContent || document.body?.textContent || "");
}

function formatSchemaRecipeToText(recipe: any): string {
  const parts: string[] = [];
  parts.push(`Title: ${recipe.name || recipe.headline || "Untitled"}`);
  if (recipe.description) parts.push(`Description: ${recipe.description}`);
  if (recipe.recipeIngredient?.length) {
    parts.push("Ingredients:");
    parts.push(...recipe.recipeIngredient.map((i: string) => `- ${i}`));
  }
  if (recipe.recipeInstructions?.length) {
    parts.push("Instructions:");
    const instructions = Array.isArray(recipe.recipeInstructions)
      ? recipe.recipeInstructions
          .map((i: any) => i.text || i.description || i.name || "")
          .filter(Boolean)
          .join("\n")
      : typeof recipe.recipeInstructions === "string"
        ? recipe.recipeInstructions
        : "";
    parts.push(instructions);
  }
  if (recipe.nutrition?.calories) parts.push(`Calories: ${recipe.nutrition.calories}`);
  if (recipe.prepTime) parts.push(`Prep Time: ${recipe.prepTime}`);
  if (recipe.cookTime) parts.push(`Cook Time: ${recipe.cookTime}`);
  return parts.join("\n");
}

async function callConsuelaParseRecipe({
  sourceLabel,
  url,
  extractedText,
}: {
  sourceLabel: string;
  url?: string;
  extractedText: string;
}) {
  const res = await fetch(process.env.HERMES_CHAT_URL || "http://localhost:3000/api/hermes/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: [
        "You are Consuela, an expert recipe parser.",
        "Parse the provided content into a single recipe.",
        "Return ONLY valid JSON with this exact shape:",
        '{"type":"recipe","title":"string","emoji":"string","prepTime":"string","tags":"string[]","ingredients":"string[]","instructions":"string","servings":number,"calories":number,"protein":number|null,"carbs":number|null,"fat":number|null}',
        "Rules:",
        "- ingredients must be a string[] of ingredient lines (no quantities normalization required)",
        "- tags should be 3-6 items from common tags like: Vegetarian, Vegan, Quick, Family Fave, Healthy, High Protein, Seafood, Comfort Food, Meal Prep, Gluten-Free, Dairy-Free, Indulgent, Fun, Kids Love",
        "- if nutrition unknown, set protein/carbs/fat to null.",
        "- instructions can be short, but must be a string.",
        "- Must not include markdown.",
        `Source: ${sourceLabel}${url ? `\nURL: ${url}` : ""}`,
        "\n--- Content ---\n",
        extractedText.slice(0, 12000),
      ].join("\n"),
    }),
  });

  const data = await res.json();
  const actions = data?.actions || [];
  const first = actions.find((a: any) => a.type === "recipe") || actions[0];
  if (!first) throw new Error("Consuela did not return a recipe action");

  const detail = first.detail;
  let parsed: any = null;

  if (typeof detail === "string") {
    try {
      parsed = JSON.parse(detail);
    } catch (e: any) {
    console.error("[recipes/ingest]", e);
      // Not JSON — ignore.
    }
  }

  if (parsed && typeof parsed === "object") {
    return {
      title: parsed.title || first.title,
      emoji: parsed.emoji || first.emoji || "📖",
      prepTime: parsed.prepTime || parsed.prep_time || "30 min",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      instructions: typeof parsed.instructions === "string" ? parsed.instructions : "",
      servings: typeof parsed.servings === "number" ? parsed.servings : Number(parsed.servings || 4),
      calories: typeof parsed.calories === "number" ? parsed.calories : Number(parsed.calories || 500),
      protein: parsed.protein ?? null,
      carbs: parsed.carbs ?? null,
      fat: parsed.fat ?? null,
    };
  }

  const detailLines = typeof detail === "string" ? detail : "";
  const parts = detailLines.split("·").map((s: string) => s.trim()).filter(Boolean);
  const prepMatch = detailLines.match(/(\d+\s*min)/i);
  const prepTime = prepMatch ? prepMatch[1] : "30 min";
  const ingredients = parts.filter((p: string) => !/(min)/i.test(p)).slice(0, 30);

  return {
    title: first.title || "Imported Recipe",
    emoji: first.emoji || "📖",
    prepTime,
    tags: ["Imported"],
    ingredients,
    instructions: "",
    servings: 4,
    calories: 500,
    protein: null,
    carbs: null,
    fat: null,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, url, sourceLabel, fileText } = body || {};

    if (type === "url") {
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Missing url" }, { status: 400 });
      }

      const scrapedText = await fetchAndExtract(url);
      if (!scrapedText || scrapedText.length < 80) {
        return NextResponse.json({ error: "Could not extract useful text from URL" }, { status: 422 });
      }

      const parsed = await callConsuelaParseRecipe({
        sourceLabel: sourceLabel || "Web",
        url,
        extractedText: scrapedText,
      });

      return NextResponse.json({ recipe: parsed });
    }

    if (type === "pdf") {
      return NextResponse.json({ error: "PDF ingestion via this endpoint not implemented yet" }, { status: 501 });
    }

    if (type === "text") {
      if (!fileText || typeof fileText !== "string") {
        return NextResponse.json({ error: "Missing fileText" }, { status: 400 });
      }

      const parsed = await callConsuelaParseRecipe({
        sourceLabel: sourceLabel || "Text",
        url: undefined,
        extractedText: fileText,
      });

      return NextResponse.json({ recipe: parsed });
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (e: any) {
    console.error("[recipes/ingest]", e);
    return NextResponse.json({ error: e?.message || "Ingestion failed" }, { status: 500 });
  }
}
