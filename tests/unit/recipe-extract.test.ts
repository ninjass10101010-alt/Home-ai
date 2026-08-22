import { describe, it, expect } from "vitest";
import {
  extractAllLdJson,
  findRecipeNode,
  normalizeSchemaImage,
  parseInstructions,
  parseIsoDuration,
  parseRecipeYield,
  schemaRecipeToRecipe,
} from "@/lib/recipe-extract";

describe("parseIsoDuration", () => {
  it("parses minutes", () => {
    expect(parseIsoDuration("PT30M")).toBe("30 min");
  });

  it("parses hours + minutes", () => {
    expect(parseIsoDuration("PT1H15M")).toBe("1 hr 15 min");
  });

  it("parses days via weeks", () => {
    expect(parseIsoDuration("P1W")).toBe("7 days");
  });

  it("parses full date-time durations", () => {
    expect(parseIsoDuration("P1DT2H")).toBe("1 day 2 hr");
  });

  it("returns null for empty duration", () => {
    expect(parseIsoDuration("PT0S")).toBeNull();
    expect(parseIsoDuration("")).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });

  it("passes through non-ISO strings", () => {
    expect(parseIsoDuration("about 45 minutes")).toBe("about 45 minutes");
  });
});

describe("normalizeSchemaImage", () => {
  it("returns plain strings", () => {
    expect(normalizeSchemaImage("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  it("takes the first usable entry of an array", () => {
    expect(normalizeSchemaImage(["", { url: "https://example.com/b.jpg" }])).toBe("https://example.com/b.jpg");
  });

  it("reads url from ImageObject", () => {
    expect(normalizeSchemaImage({ "@type": "ImageObject", url: "https://example.com/c.jpg" })).toBe(
      "https://example.com/c.jpg",
    );
  });

  it("returns undefined for empty/unknown shapes", () => {
    expect(normalizeSchemaImage(undefined)).toBeUndefined();
    expect(normalizeSchemaImage({})).toBeUndefined();
    expect(normalizeSchemaImage([])).toBeUndefined();
  });
});

describe("parseRecipeYield", () => {
  it("parses numbers", () => {
    expect(parseRecipeYield(6)).toBe(6);
  });

  it("parses strings with digits", () => {
    expect(parseRecipeYield("4 servings")).toBe(4);
  });

  it("parses arrays and QuantitativeValue objects", () => {
    expect(parseRecipeYield(["8"])).toBe(8);
    expect(parseRecipeYield({ minValue: 2 })).toBe(2);
  });

  it("returns undefined when nothing usable", () => {
    expect(parseRecipeYield(undefined)).toBeUndefined();
    expect(parseRecipeYield("serves many")).toBeUndefined();
  });
});

describe("parseInstructions", () => {
  it("joins HowToStep arrays", () => {
    const steps = [
      { "@type": "HowToStep", text: "Boil water." },
      { "@type": "HowToStep", text: "Add pasta." },
    ];
    expect(parseInstructions(steps)).toBe("Boil water.\nAdd pasta.");
  });

  it("handles HowToSection with nested steps", () => {
    const sections = [
      { "@type": "HowToSection", name: "Sauce", itemListElement: [{ text: "Simmer." }] },
    ];
    expect(parseInstructions(sections)).toBe("Simmer.");
  });

  it("handles plain strings", () => {
    expect(parseInstructions("Mix  and bake")).toBe("Mix and bake");
  });

  it("handles ItemList wrappers", () => {
    expect(parseInstructions({ "@type": "ItemList", itemListElement: [{ text: "Step one" }, { text: "Step two" }] }))
      .toBe("Step one\nStep two");
  });
});

describe("findRecipeNode + extractAllLdJson", () => {
  it("finds a Recipe in the second ld+json block", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization","name":"Blog"}</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Tacos","recipeIngredient":["1 shell"]}</script>
    `;
    const blocks = extractAllLdJson(html);
    expect(blocks).toHaveLength(2);
    const node = findRecipeNode(blocks[0]) ?? findRecipeNode(blocks[1]);
    expect(node?.name).toBe("Tacos");
  });

  it("finds a Recipe inside an @graph array", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "Page" },
        { "@type": ["Recipe"], name: "Graph Soup", recipeIngredient: ["1 cup broth"] },
      ],
    };
    const node = findRecipeNode(graph);
    expect(node?.name).toBe("Graph Soup");
  });

  it("finds a Recipe nested in mainEntity", () => {
    const node = findRecipeNode({ "@type": "WebPage", mainEntity: { "@type": "Recipe", name: "Nested" } });
    expect(node?.name).toBe("Nested");
  });

  it("skips malformed blocks and keeps parsing others", () => {
    const html = `
      <script type="application/ld+json">{not valid json</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Still Works"}</script>
    `;
    const blocks = extractAllLdJson(html);
    expect(blocks).toHaveLength(1);
    expect(findRecipeNode(blocks[0])?.name).toBe("Still Works");
  });

  it("returns null when no Recipe exists", () => {
    expect(findRecipeNode({ "@type": "Organization" })).toBeNull();
    expect(findRecipeNode(null)).toBeNull();
  });
});

describe("schemaRecipeToRecipe", () => {
  it("maps a full schema.org Recipe node", () => {
    const recipe = schemaRecipeToRecipe(
      {
        "@type": "Recipe",
        name: "  Chili  ",
        description: "Hearty.",
        image: ["", { url: "https://example.com/chili.jpg" }],
        prepTime: "PT15M",
        cookTime: "PT1H30M",
        totalTime: "PT1H45M",
        recipeYield: "6 servings",
        recipeIngredient: ["1 lb beef", " 2 cans beans "],
        recipeInstructions: [{ "@type": "HowToStep", text: "Brown beef." }, { "@type": "HowToStep", text: "Simmer." }],
        nutrition: { calories: "420 calories" },
        author: { "@type": "Person", name: "Rebecca" },
      },
      "https://example.com/chili",
    );
    expect(recipe.name).toBe("Chili");
    expect(recipe.image).toBe("https://example.com/chili.jpg");
    expect(recipe.prepTime).toBe("15 min");
    expect(recipe.cookTime).toBe("1 hr 30 min");
    expect(recipe.totalTime).toBe("1 hr 45 min");
    expect(recipe.servings).toBe(6);
    expect(recipe.ingredients).toEqual(["1 lb beef", "2 cans beans"]);
    expect(recipe.instructions).toBe("Brown beef.\nSimmer.");
    expect(recipe.calories).toBe(420);
    expect(recipe.author).toBe("Rebecca");
    expect(recipe.sourceUrl).toBe("https://example.com/chili");
  });
});
