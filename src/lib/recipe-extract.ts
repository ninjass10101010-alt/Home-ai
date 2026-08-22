export interface ExtractedRecipe {
  name: string;
  description?: string;
  image?: string;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  servings?: number;
  ingredients: string[];
  instructions: string;
  calories?: number;
  author?: string;
  sourceUrl?: string;
}

export function parseIsoDuration(iso: unknown): string | null {
  if (iso == null) return null;
  const raw = String(iso).trim();
  if (!raw) return null;
  const m = raw
    .toUpperCase()
    .match(
      /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
    );
  if (!m) return raw;
  const weeks = Number(m[3] || 0);
  const days = Number(m[4] || 0) + weeks * 7;
  const hours = Number(m[5] || 0);
  const minutes = Number(m[6] || 0);
  const seconds = Number(m[7] || 0);
  if (!days && !hours && !minutes && !seconds) return null;
  const parts: string[] = [];
  if (days) parts.push(`${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`);
  if (hours) parts.push(`${Math.round(hours)} hr`);
  if (minutes) parts.push(`${Math.round(minutes)} min`);
  if (!parts.length && seconds) parts.push(`${Math.round(seconds)} sec`);
  return parts.length ? parts.join(" ") : null;
}

export function normalizeSchemaImage(image: unknown): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") {
    const trimmed = image.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(image)) {
    for (const item of image) {
      const url = normalizeSchemaImage(item);
      if (url) return url;
    }
    return undefined;
  }
  if (typeof image === "object") {
    const obj = image as Record<string, unknown>;
    const candidate = obj.url ?? obj.contentUrl ?? obj.representativeOfPage ?? obj["@image"];
    return normalizeSchemaImage(candidate);
  }
  return undefined;
}

export function parseRecipeYield(recipeYield: unknown): number | undefined {
  if (recipeYield == null) return undefined;
  if (Array.isArray(recipeYield)) return parseRecipeYield(recipeYield[0]);
  if (typeof recipeYield === "number") {
    return Number.isFinite(recipeYield) && recipeYield > 0 ? Math.round(recipeYield) : undefined;
  }
  if (typeof recipeYield === "object") {
    const obj = recipeYield as Record<string, unknown>;
    return parseRecipeYield(obj.minValue ?? obj.value);
  }
  const digits = String(recipeYield).match(/\d+/);
  return digits ? Math.max(1, parseInt(digits[0], 10)) : undefined;
}

export function parseInstructions(instructions: unknown): string {
  if (!instructions) return "";
  if (typeof instructions === "string") return instructions.replace(/\s+/g, " ").trim();
  if (Array.isArray(instructions)) {
    return instructions
      .map((item) => parseInstructions(item))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof instructions === "object") {
    const obj = instructions as Record<string, any>;
    if (typeof obj.text === "string" && obj.text.trim()) {
      return obj.text.replace(/\s+/g, " ").trim();
    }
    if (typeof obj.item === "string" && obj.item.trim()) {
      return obj.item.replace(/\s+/g, " ").trim();
    }
    const steps = obj.steps ?? obj.itemListElement;
    const stepTexts = Array.isArray(steps)
      ? steps.map((step: unknown) => parseInstructions(step)).filter(Boolean)
      : [];
    if (stepTexts.length) return stepTexts.join("\n");
    if (typeof obj.name === "string" && obj.name.trim()) {
      return obj.name.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function typeIncludesRecipe(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && t.toLowerCase() === "recipe");
}

export function findRecipeNode(data: unknown): Record<string, any> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, any>;
  if (typeIncludesRecipe(obj["@type"])) return obj;
  for (const key of ["@graph", "mainEntity", "itemListElement", "steps", "item"]) {
    if (obj[key]) {
      const found = findRecipeNode(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

export function extractAllLdJson(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // malformed block — skip and keep looking at the others
    }
  }
  return blocks;
}

function parseCalories(nutrition: unknown): number | undefined {
  if (!nutrition || typeof nutrition !== "object") return undefined;
  const calories = (nutrition as Record<string, unknown>).calories;
  if (calories == null) return undefined;
  if (typeof calories === "number") return Number.isFinite(calories) ? Math.round(calories) : undefined;
  const digits = String(calories).match(/\d+/);
  return digits ? parseInt(digits[0], 10) : undefined;
}

function parseAuthor(author: unknown): string | undefined {
  if (!author) return undefined;
  if (typeof author === "string") return author.trim() || undefined;
  if (Array.isArray(author)) return parseAuthor(author[0]);
  if (typeof author === "object") {
    const name = (author as Record<string, unknown>).name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  }
  return undefined;
}

export function schemaRecipeToRecipe(node: Record<string, any>, sourceUrl?: string): ExtractedRecipe {
  const ingredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient.map((i: unknown) => String(i ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  return {
    name:
      String(node.name || node.headline || "")
        .replace(/\s+/g, " ")
        .trim() || "Imported recipe",
    description: typeof node.description === "string" ? node.description.replace(/\s+/g, " ").trim() : undefined,
    image: normalizeSchemaImage(node.image),
    prepTime: parseIsoDuration(node.prepTime) ?? undefined,
    cookTime: parseIsoDuration(node.cookTime) ?? undefined,
    totalTime: parseIsoDuration(node.totalTime) ?? undefined,
    servings: parseRecipeYield(node.recipeYield),
    ingredients,
    instructions: parseInstructions(node.recipeInstructions),
    calories: parseCalories(node.nutrition),
    author: parseAuthor(node.author),
    sourceUrl,
  };
}
