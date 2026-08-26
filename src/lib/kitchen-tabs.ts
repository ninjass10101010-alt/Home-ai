export type KitchenTab = "plan" | "shop" | "stock";

const LEGACY_MAP: Record<string, KitchenTab> = {
  meals: "plan",
  recipes: "plan",
  grocery: "shop",
  pantry: "stock",
  plan: "plan",
  shop: "shop",
  stock: "stock",
};

export function mapKitchenTabParam(param: string | null): KitchenTab {
  if (!param) return "plan";
  return LEGACY_MAP[param] ?? "plan";
}

export function isRecipesDeepLink(param: string | null): boolean {
  return param === "recipes";
}
