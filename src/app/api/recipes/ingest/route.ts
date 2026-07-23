import { NextResponse } from "next/server";

// Playwright is expected to be installed in this project.
// If it isn’t yet, you’ll need: npm i -D playwright && npx playwright install
import { chromium } from "playwright";

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
    // Using a local route keeps consistent behavior with existing code.
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
  // Existing hermes/chat format in repo:
  // { actions: [{ type: "meal" | "recipe" | ... , title, detail, emoji }, ...] }
  const actions = data?.actions || [];
  const first = actions.find((a: any) => a.type === "recipe") || actions[0];
  if (!first) throw new Error("Consuela did not return a recipe action");

  // If detail contains the JSON, try to parse.
  // Otherwise, fallback to simple mapping from title/emoji/detail.
  // This makes it resilient to minor response format variations.
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

  // If parsed exists and contains shape, use it.
  if (parsed && typeof parsed === "object") {
    const normalized = {
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

    return normalized;
  }

  // Fallback: interpret detail as "Prep time · ing1 · ing2".
  const detailLines = typeof detail === "string" ? detail : "";
  const parts = detailLines
    .split("·")
    .map((s: string) => s.trim())
    .filter(Boolean);

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

function cleanExtractedText(s: string) {
  // Remove excessive whitespace.
  return s.replace(/\s+/g, " ").trim();
}

async function scrapeUrlText(url: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Give some time for dynamic content.
    await page.waitForTimeout(2000);

    // Extract visible text.
    const text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return "";
      return body.innerText || body.textContent || "";
    });

    return cleanExtractedText(text || "");
  } finally {
    await browser.close();
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, url, sourceLabel, fileText } = body || {};

    if (type === "url") {
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Missing url" }, { status: 400 });
      }

      const scrapedText = await scrapeUrlText(url);
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
      // Optional for now; your current PDF import already works client-side.
      // Return a clear message instead of failing.
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

