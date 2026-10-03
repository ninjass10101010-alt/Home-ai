import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import {
  extractAllLdJson,
  findRecipeNode,
  schemaRecipeToRecipe,
  type ExtractedRecipe,
} from "@/lib/recipe-extract";
import { requireLiveSession } from "@/lib/server-auth";
import {
  OutboundRequestError,
  safeFetchOutboundText,
  type SafeFetchResult,
} from "@/lib/safe-fetch";

// One deadline for the WHOLE import fetch — every redirect hop and the CDN
// user-agent retry share it, so a chain of slow hops cannot multiply into a
// multi-minute hold on a server worker.
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Tried in order. Many CDNs 403 a non-browser UA outright, so the second entry
// is a browser-shaped string; the guard re-validates the target on the retry.
const IMPORT_USER_AGENTS: readonly string[] = [
  "Consuela-Dashboard/1.0 RecipeImporter",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

function cleanExtractedText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Fetch a page the caller pasted, under the shared SSRF guard.
 *
 * `safeFetchOutboundText` owns every network rule — scheme, hostname shape, the
 * resolved address on EACH redirect hop, the byte cap and the deadline — and
 * throws `OutboundRequestError` with the status to answer with. This function
 * only adds the human copy the import sheet shows.
 *
 * It returns the VALIDATED FINAL url, not the string the caller typed: a recipe
 * must never record `http://127.0.0.1/` as its provenance.
 */
async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  let result: SafeFetchResult;
  try {
    result = await safeFetchOutboundText(url, {
      userAgents: IMPORT_USER_AGENTS,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
    });
  } catch (error) {
    if (error instanceof OutboundRequestError) throw error;
    // Never a recipe: a failed fetch yields no text to fall back on, so this
    // path cannot echo an unfetched body back to the caller.
    throw new OutboundRequestError(
      "network_error",
      502,
      "Could not reach that site. Check the link and try again.",
    );
  }

  if (!result.ok) {
    if (result.status === 403 || result.status === 401) {
      throw new OutboundRequestError(
        "http_status",
        403,
        "This site blocks automatic import. Try copying the recipe text and using the Paste text tab instead.",
      );
    }
    if (result.status === 429) {
      throw new OutboundRequestError(
        "http_status",
        429,
        "This site is rate-limiting imports right now. Wait a minute and try again, or paste the recipe text instead.",
      );
    }
    if (result.status === 404) {
      throw new OutboundRequestError(
        "http_status",
        404,
        "That page could not be found (404). Check the link and try again.",
      );
    }
    throw new OutboundRequestError(
      "http_status",
      502,
      `The site responded with an error (${result.status}). Try again in a moment.`,
    );
  }

  return { html: result.text, finalUrl: result.url };
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

// This route is privileged on both axes, so it is parent-only:
//   * it fetches an ARBITRARY caller-supplied URL from the server, and
//   * it spends the paid LLM key on whatever text comes back.
// The gate re-reads the live PocketBase member row and its CURRENT role —
// the signed cookie's role is never trusted, and a PocketBase outage fails
// closed (503) rather than falling through to an open door. Same seam as
// /api/consuela/planner/apply and /api/services/test.
export async function POST(req: Request) {
  const live = await requireLiveSession(req, { requireRole: "parent" });
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }

  try {
    const body = await req.json();
    const { type, url, sourceLabel, fileText } = body || {};

    if (type === "url") {
      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Missing url" }, { status: 400 });
      }

      let html: string;
      // The validated url the body actually came from. Provenance is recorded
      // from this, never from the submitted string.
      let sourceUrl: string;
      try {
        const fetched = await fetchHtml(url);
        html = fetched.html;
        sourceUrl = fetched.finalUrl;
      } catch (e: any) {
        if (e instanceof OutboundRequestError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json(
          { error: "Could not reach that site. Check the link and try again." },
          { status: 502 },
        );
      }

      const structured = extractStructuredRecipe(html, sourceUrl);
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
          url: sourceUrl,
          extractedText: scrapedText,
        });
        return NextResponse.json({ recipe: { ...parsed, sourceUrl }, structured: false });
      } catch {
        // Honest fallback: the parse failed, so the page text is offered as-is
        // and flagged `needsReview`. The text was genuinely fetched from the
        // validated public url above — this is never a stand-in for a failed
        // fetch.
        return NextResponse.json({
          recipe: recipeFromTextFallback(scrapedText, sourceUrl),
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
