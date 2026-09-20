const FRACTION = "[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]";
const NUMBER = "(?:\\d+(?:[.,]\\d+)?)";
const QUANTITY = `(?:${NUMBER}(?:\\s*(?:${FRACTION}|(?:\\d+\\s*[/]\\s*\\d+)|(?:to|\\-|–|—)\\s*${NUMBER}))?|${FRACTION}|\\d+\\s*[/]\\s*\\d+)`;

const UNITS = new Set([
  "cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons",
  "lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces",
  "g", "gram", "grams", "kg", "kilogram", "kilograms",
  "ml", "milliliter", "milliliters", "l", "liter", "liters", "cl", "centiliter", "centiliters",
  "clove", "cloves", "can", "cans", "jar", "jars", "bottle", "bottles",
  "pinch", "pinches", "bunch", "bunches", "slice", "slices", "stick", "sticks",
  "stalk", "stalks", "head", "heads", "piece", "pieces", "package", "packages",
  "packet", "packets", "bag", "bags", "box", "boxes", "sheet", "sheets",
  "sprig", "sprigs", "dash", "dashes", "drop", "drops",
  "whole", "small", "medium", "large",
]);

export interface ParsedIngredient {
  quantity: string;
  unit: string;
  rest: string;
}

export function parseIngredientLine(line: string): ParsedIngredient | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(new RegExp(`^\\s*(${QUANTITY})\\s+`));
  if (!m) return null;
  const quantity = m[1].trim();
  const after = trimmed.slice(m[0].length);
  const unitMatch = after.match(/^([A-Za-z]+)\s+/);
  let unit = "";
  let rest = after;
  if (unitMatch && UNITS.has(unitMatch[1].toLowerCase())) {
    unit = unitMatch[1];
    rest = after.slice(unitMatch[0].length).trim();
  } else {
    rest = rest.trim();
  }
  if (!rest) return null;
  return { quantity, unit, rest };
}
