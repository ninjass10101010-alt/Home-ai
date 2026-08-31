export type StoreId =
  | "aldi"
  | "meijer"
  | "walmart"
  | "target-corp"
  | "family-fare-supermarkets"
  | "costco"
  | "d-w-fresh-market"
  | "fresh-thyme-farmers-market"
  | "forest-hills"
  | "martins-super-markets"
  | "gfs"
  | "ada-fresh-market"
  | "bridge-street-market"
  | "rogers-foodland"
  | "leppinks-food-center"
  | "leppinks-marketplace"
  | "hardings-market"
  | "save-a-lot"
  | "any";

export interface StoreDef {
  id: StoreId;
  label: string;
  pinned: boolean;
}

export const PINNED_STORES: StoreDef[] = [
  { id: "aldi", label: "ALDI", pinned: true },
  { id: "meijer", label: "Meijer", pinned: true },
  { id: "walmart", label: "Walmart", pinned: true },
  { id: "target-corp", label: "Target", pinned: true },
  { id: "family-fare-supermarkets", label: "Family Fare", pinned: true },
  { id: "costco", label: "Costco", pinned: true },
];

export const ALL_STORES: StoreDef[] = [
  ...PINNED_STORES,
  { id: "d-w-fresh-market", label: "D&W Fresh Market", pinned: false },
  { id: "fresh-thyme-farmers-market", label: "Fresh Thyme", pinned: false },
  { id: "forest-hills", label: "Forest Hills", pinned: false },
  { id: "martins-super-markets", label: "Martin's", pinned: false },
  { id: "gfs", label: "Gordon Food Service", pinned: false },
  { id: "ada-fresh-market", label: "Ada Fresh Market", pinned: false },
  { id: "bridge-street-market", label: "Bridge Street Market", pinned: false },
  { id: "rogers-foodland", label: "Rogers Foodland", pinned: false },
  { id: "leppinks-food-center", label: "Leppink's", pinned: false },
  { id: "leppinks-marketplace", label: "Leppink's Marketplace", pinned: false },
  { id: "hardings-market", label: "Harding's", pinned: false },
  { id: "save-a-lot", label: "Save A Lot", pinned: false },
];

export const STORE_LABELS: Record<string, string> = Object.fromEntries(
  ALL_STORES.map((s) => [s.id, s.label])
);

export function getStoreLabel(storeId: string): string {
  return STORE_LABELS[storeId] ?? "Any";
}

const CATEGORY_DEFAULTS: Record<string, StoreId> = {
  produce: "aldi",
  dairy: "aldi",
  meat: "meijer",
  seafood: "meijer",
  bulk: "costco",
  pantry: "meijer",
  frozen: "aldi",
  snacks: "aldi",
  beverages: "aldi",
  household: "target-corp",
  personal: "target-corp",
};

export function getDefaultStore(category: string): StoreId {
  return CATEGORY_DEFAULTS[category.toLowerCase()] ?? "any";
}
