import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import {
  extractAllLdJson,
  findRecipeNode,
  schemaRecipeToRecipe,
  type ExtractedRecipe,
} from "@/lib/recipe-extract";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

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

class FetchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readBodyCapped(res: Response): Promise<string> {
  const lengthHeader = Number(res.headers.get("content-length"));
  if (Number.isFinite(lengthHeader) && lengthHeader > MAX_BODY_BYTES) {
    throw new FetchError(413, "Page is too large to import");
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {});
        throw new FetchError(413, "Page is too large to import");
      }
      chunks.push(value);
    }
  }
  return new TextDecoder("utf-8").decode(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
}

async function fetchHtml(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchError(400, "That doesn't look like a valid link. It should start with http:// or https://");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new FetchError(400, "Only HTTP and HTTPS URLs are allowed");
  }
  if (isPrivateIP(parsed.hostname)) {
    throw new FetchError(400, "Private network URLs are not allowed");
  }

  const doFetch = (userAgent: string) =>
    fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

  let res = await doFetch("Consuela-Dashboard/1.0 RecipeImporter");
  if (res.status === 403) {
    // Many CDNs block non-browser UAs outright — retry once with a common one.
    res = await doFetch(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
  }

  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new FetchError(
        403,
        "This site blocks automatic import. Try copying the recipe text and using the Paste text tab instead.",
      );
    }
    if (res.status === 429) {
      throw new FetchError(
        429,
        "This site is rate-limiting imports right now. Wait a minute and try again, or paste the recipe text instead.",
      );
    }
    if (res.status === 404) {
      throw new FetchError(404, "That page could not be found (404). Check the link and try again.");
    }
    throw new FetchError(502, `The site responded with an error (${res.status}). Try again in a moment.`);
  }

  return readBodyCapped(res);
}

function extractStructuredRecipe(html: string, url: string): ExtractedRecipe | null {
  const blocks = extractAllLdJson(html);
  for (const block of blocks) {
    const node = findRecipeNode(block);
    if (node) {
      const recipe = schemaRecipeToRecipe(node, url);
      if (recipe.name && (recipe.ingredients.length || recipe.instructions)) return recipe;
    }
  }
  return null;
}

function extractReadableText(html: string): string {
  const { document } = parseHTML(html);
  const reader = new Readability(document.cloneNode(true) as any);
  const article = reader.parse();
  return cleanExtractedText(article?.textContent || document.body?.textContent || "");
}

function recipeFromTextFallback(text: string, sourceUrl?: string) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0]?.slice(0, 120) || "Imported recipe";
  return {
    title: name,
    emoji: "📖",
    prepTime: "30 min",
    tags: ["Imported"],
    ingredients: [],
    instructions: text.slice(0, 4000),
    servings: 4,
    calories: 0,
    protein: null,
    carbs: null,
    fat: null,
    image: undefined,
    sourceUrl,
    needsReview: true,
  };
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
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`Consuela unavailable (${res.status})`);

  const data = await res.json();
  const actions = data?.actions || [];
  let first = actions.find((a: any) => a.type === "recipe") || actions[0];

  if (!first && typeof data?.content === "string") {
    const contentMatch = data.content.match(/\{[\s\S]*\}/);
    if (contentMatch) {
      try {
        const contentJson = JSON.parse(contentMatch[0]);
        if (contentJson && typeof contentJson === "object" && (contentJson.title || contentJson.ingredients)) {
          first = { type: "recipe", detail: JSON.stringify(contentJson) };
        }
      } catch {
        // not JSON content — fall through
      }
    }
  }

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

      let html: string;
      try {
        html = await fetchHtml(url);
      } catch (e: any) {
        if (e instanceof FetchError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        if (e?.name === "TimeoutError" || e?.name === "AbortError") {
          return NextResponse.json(
            { error: "The site took too long to respond. Try again, or paste the recipe text instead." },
            { status: 504 },
          );
        }
        return NextResponse.json(
          { error: "Could not reach that site. Check the link and try again." },
          { status: 502 },
        );
      }

      const structured = extractStructuredRecipe(html, url);
      if (structured) {
        return NextResponse.json({
          recipe: {
            title: structured.name,
            emoji: "📖",
            description: structured.description,
            prepTime: structured.prepTime || structured.totalTime || "30 min",
            cookTime: structured.cookTime,
            totalTime: structured.totalTime,
            tags: ["Imported"],
            ingredients: structured.ingredients,
            instructions: structured.instructions,
            servings: structured.servings ?? 4,
            calories: structured.calories ?? 0,
            protein: null,
            carbs: null,
            fat: null,
            image: structured.image,
            author: structured.author,
            sourceUrl: structured.sourceUrl,
          },
          structured: true,
        });
      }

      const scrapedText = extractReadableText(html);
      if (!scrapedText || scrapedText.length < 80) {
        return NextResponse.json(
          {
            error:
              "Could not find a recipe on that page. If it's a video or app-only post, try the Paste text tab instead.",
          },
          { status: 422 },
        );
      }

      try {
        const parsed = await callConsuelaParseRecipe({
          sourceLabel: sourceLabel || "Web",
          url,
          extractedText: scrapedText,
        });
        return NextResponse.json({ recipe: { ...parsed, sourceUrl: url }, structured: false });
      } catch {
        return NextResponse.json({
          recipe: recipeFromTextFallback(scrapedText, url),
          structured: false,
          needsReview: true,
        });
      }
    }

    if (type === "pdf") {
      return NextResponse.json({ error: "PDF ingestion via this endpoint not implemented yet" }, { status: 501 });
    }

    if (type === "text") {
      if (!fileText || typeof fileText !== "string") {
        return NextResponse.json({ error: "Missing fileText" }, { status: 400 });
      }

      try {
        const parsed = await callConsuelaParseRecipe({
          sourceLabel: sourceLabel || "Text",
          url: undefined,
          extractedText: fileText,
        });
        return NextResponse.json({ recipe: parsed, structured: false });
      } catch {
        return NextResponse.json({
          recipe: recipeFromTextFallback(fileText),
          structured: false,
          needsReview: true,
        });
      }
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (e: any) {
    console.error("[recipes/ingest]", e);
    return NextResponse.json({ error: e?.message || "Ingestion failed" }, { status: 500 });
  }
}
