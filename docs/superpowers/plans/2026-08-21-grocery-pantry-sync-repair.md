# Grocery ↔ Pantry Sync Repair + Pantry-Aware Cooking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken grocery→pantry handoff (items that can't be cleared, resurrecting rows, silently-failing syncs) and ship the two documented-but-unbuilt features (manual-override lock, CookWithWhatYouHave).

**Architecture:** PocketBase is the primary store with a client cache + localStorage fallback. The root cause of nearly every bug is an **ID mismatch**: locally-created grocery items get fake `Date.now()` ids while PB assigns its own string ids, so deletes/updates miss their records. We fix the ID chain first (id-first upsert matching, real ids returned into React state), then rebuild the handoff so "remove from list" never depends on "add to pantry" succeeding, then make meal-sync updates honest, then add the two features.

**Tech Stack:** Next.js 16 + React 19 + TypeScript, PocketBase (`src/db/pb-db.ts` facade in `src/db/index.ts`), Vitest (`tests/unit/`, jsdom for component/hook tests), Tailwind CSS 4.

## Global Constraints

- Test baseline is **172/173 passing** — `tests/integration/api-routes.test.ts` fails without PB env vars and is a **pre-existing** failure. Never count it against this work.
- Verification commands (run from `Home-ai/`): `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`.
- Kitchen tabs (Meals/Grocery/Pantry/Recipes) are **calm input surfaces** — no new float/bob/scale animations (AGENTS.md §1.3). Use existing `.tap` / `.tap-sm` classes for tappable elements.
- After the final code task, AGENTS.md **must** be updated (snapshot + UI Change Record + Change Log) per repo convention.
- The working tree already contains uncommitted nav changes (`CapsuleNav.tsx`, `test-capsule-nav.mjs`, `AGENTS.md`) from a previous task. Every commit in this plan stages **only its own files** by explicit path.
- DRY/YAGNI: no new dependencies, no refactors beyond what tasks specify.

---

## 🐛 Bug Registry (what this plan fixes)

| ID | Severity | Bug | Root cause location | Fixed in |
|----|----------|-----|---------------------|----------|
| **BUG-1** | 🔴 User-reported | Checked items **already in the pantry never leave the grocery list** — "Send N to pantry" says "already there" and the row stays; pressing again does nothing forever | `src/components/meals/GroceryTab.tsx:117-119` (bulk `continue`), `:91-92` (single early-return) | Task 5 |
| **BUG-2** | 🔴 User-reported ("list does not clear") | Locally-added grocery items get a **fake `Date.now()` id**; PB delete-by-that-id 404s silently (`safeDelete` swallows it), the UI clears the row anyway, and the PB row **resurrects on reload / 60s cache refresh / other devices** | `src/lib/grocery-service.ts:61-75` (fake id), `src/db/pb-db.ts:297-312` (name-only match, delete by wrong id), `src/db/pb-db.ts:61-70` (silent 404) | Tasks 1–3 |
| **BUG-3** | 🔴 Silent data loss | All 4 `mealSyncService` update paths **silently fail**: update payload has no `name`, and `pbDb.upsertGroceryItem` matches by name only → PB rejects the nameless create, `safeCreate` returns null, but code still counts `updated++` → **lying toast counts**, meal-sync quantities never update, "plenty" pantry items never uncheck grocery rows | `src/services/mealSync.ts:268-275` + `src/db/pb-db.ts:297-304` | Tasks 1, 6 |
| **BUG-4** | 🟠 Data loss | Quantity/unit **dropped at grocery→pantry handoff** (`addPantryItem(name, "plenty")`) even though `pantry_items` has `quantity`/`unit` fields and `calculateDeficit` supports real quantity math | `GroceryTab.tsx:95,120`, `src/hooks/usePantry.ts:57-69` | Tasks 4–5 |
| **BUG-5** | 🟠 Resurrection | **Empty lists never persist** — `if (items.length) setItem(...)` keeps the stale localStorage copy; if PB is unreachable on reload, cleared items reappear | `src/hooks/useGrocery.ts:102-104`, `src/hooks/usePantry.ts:53-55` | Tasks 3–4 |
| **BUG-6** | 🟡 UX | **Undo pollutes "Recently Bought"** — undo re-adds via `addGroceryItem`, which always pushes into the recently-bought chips | `src/hooks/useGrocery.ts:135-138` | Task 3 |
| **BUG-7** | 🟡 UX | **Toast spam during bulk send** — every pantry add fires its own toast, clobbering the summary toast | `src/hooks/usePantry.ts:67` | Tasks 4–5 |
| **BUG-8** | 🟡 Landmine | Dead helper `mergePantryWithDb` does `Number(item.id)` → **NaN for PB string ids** — unused today, fatal if reused | `src/hooks/usePantry.ts:16-26` | Task 4 |

**Unbuilt-but-planned features this plan ships:**
- **Manual-override toggle** — promised in the 2026-06-15 changelog ("user can toggle manual override"), field seeded and respected by sync, but no UI ever called `toggleManualOverride` (Task 7).
- **`CookWithWhatYouHave`** — `MEAL_SYSTEM_ARCHITECTURE.md §6` says `findCookableRecipes()` is "ready for UI integration"; the component never existed (Task 8).

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/types/meals.ts` | Widen `GroceryItem.id` / `PantryItem.id` to `number \| string` | 1 |
| `src/db/pb-db.ts` | id-first upsert matching, strip `id` from PB payloads | 1 |
| `src/hooks/useGrocery.ts` | Real-id CRUD, loaded-gated persistence, silent mode, override toggle | 1, 3, 7 |
| `src/hooks/usePantry.ts` | quantity/unit + silent opts, loaded-gated persistence, delete dead code | 1, 4 |
| `src/lib/grocery-service.ts` | Return real PB records, `parseQuantityString` helper | 2 |
| `src/components/meals/GroceryTab.tsx` | Decoupled handoff, pin lock button | 1, 5, 7 |
| `src/components/meals/PantryTab.tsx` | pendingDeleteId type, CookWithWhatYouHave slot | 1, 8 |
| `src/services/mealSync.ts` | Honest id-based updates | 1, 6 |
| `src/components/meals/CookWithWhatYouHave.tsx` | NEW — pantry-ranked recipe card | 8 |
| `src/app/meals/page.tsx` | Wire new props through | 5, 7, 8 |
| `tests/unit/*.test.{ts,tsx}` | One test file per task | 1–8 |
| `AGENTS.md` | Mandatory docs update | 9 |

---

### Task 1: ID foundation — widen types, id-first PB matching

**Files:**
- Modify: `src/types/meals.ts:45-73`
- Modify: `src/db/pb-db.ts:297-304`
- Modify: `src/hooks/useGrocery.ts:148,162,167` (signatures only)
- Modify: `src/hooks/usePantry.ts:71,78` (signatures only)
- Modify: `src/components/meals/GroceryTab.tsx:41,47,84` (state types only)
- Modify: `src/components/meals/PantryTab.tsx:65` (state type only)
- Modify: `src/services/mealSync.ts:157` (signature only)
- Test: `tests/unit/pb-db-grocery.test.ts` (create)

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: `GroceryItem.id: number | string`, `PantryItem.id: number | string`; `pbDb.upsertGroceryItem` matches by `id` first then name and never sends `id` in the PB payload. All later tasks rely on ids being real PB ids.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pb-db-grocery.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[], calls: [] as any[] };
  const collectionMock = {
    getFullList: async () => state.records.map(r => ({ ...r })),
    create: async (data: any) => {
      state.calls.push(["create", data]);
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      state.calls.push(["update", id, data]);
      const rec = state.records.find(r => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
    delete: async (id: string) => {
      state.calls.push(["delete", id]);
      const idx = state.records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error("404 not found");
      state.records.splice(idx, 1);
    },
  };
  return { state, collectionMock };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => h.collectionMock }),
  getAdminPB: () => ({ collection: () => h.collectionMock, autoCancellation: () => {} }),
}));

import { db } from "@/db/pb-db";

describe("pb-db grocery id handling", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.calls = [];
  });

  it("updates the record matched by id and omits id from the payload", async () => {
    h.state.records.push({ id: "pb_1", name: "Milk", needed: true });
    const saved = await db.upsertGroceryItem({ id: "pb_1", name: "Milk", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toBe("pb_1");
    expect(updateCall![2]).not.toHaveProperty("id");
    expect(saved?.needed).toBe(false);
  });

  it("falls back to name matching when no id is provided", async () => {
    h.state.records.push({ id: "pb_2", name: "Eggs", needed: true });
    await db.upsertGroceryItem({ name: "eggs", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall![1]).toBe("pb_2");
  });

  it("creates a new record without id in the payload when nothing matches", async () => {
    const saved = await db.upsertGroceryItem({ name: "Bread", needed: true });
    const createCall = h.state.calls.find(c => c[0] === "create");
    expect(createCall).toBeTruthy();
    expect(createCall![1]).not.toHaveProperty("id");
    expect(saved?.id).toBeTruthy();
  });

  it("deleteGroceryItem removes the record by string id", async () => {
    h.state.records.push({ id: "pb_3", name: "Butter" });
    const ok = await db.deleteGroceryItem("pb_3");
    expect(ok).toBe(true);
    expect(h.state.records).toHaveLength(0);
  });

  it("deleteGroceryItem returns false for an unknown id instead of throwing", async () => {
    const ok = await db.deleteGroceryItem("does_not_exist");
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pb-db-grocery.test.ts`
Expected: FAIL — "omits id from the payload" fails (current code passes `id` through in the payload and matches by name only).

- [ ] **Step 3: Widen the id types**

In `src/types/meals.ts` change both interfaces (only the `id` line changes in each):

```ts
export interface PantryItem {
  id: number | string;
  item: string;
  name?: string;
  status: "plenty" | "low" | "out";
  quantity?: number;
  unit?: string;
}

export interface GroceryItem {
  id: number | string;
  userId?: string;
  name: string;
  emoji: string;
  category: string;
  aisle?: string;
  quantity?: string;
  notes?: string;
  priority: "low" | "medium" | "high";
  needed: boolean;
  manualOverride?: boolean;
  lastSyncedAt?: string;
  source?: string;
  autoGenerated?: boolean;
  updatedAt?: string;
  quantityValue?: number;
  unit?: string;
  pinned?: boolean;
}
```

- [ ] **Step 4: Make `pbDb.upsertGroceryItem` id-first and strip `id` from payloads**

In `src/db/pb-db.ts` replace the `upsertGroceryItem` method (lines 297-304):

```ts
  async upsertGroceryItem(item: any): Promise<any> {
    const items = await safeList<any>("grocery_list_items", []);
    const byId = item.id != null
      ? items.find((g: any) => String(g.id) === String(item.id))
      : undefined;
    const existing = byId || items.find((g: any) =>
      g.name?.toLowerCase() === item.name?.toLowerCase() && !g.manualOverride
    );
    const { id: _omitId, ...data } = item;
    if (existing) return safeUpdate("grocery_list_items", existing.id, data);
    return safeCreate("grocery_list_items", data);
  },
```

- [ ] **Step 5: Fix the type ripple (signatures and state types only — no behavior changes)**

`src/hooks/useGrocery.ts`:
```ts
  const toggleGroceryNeeded = async (id: number | string) => {
```
```ts
  const deleteGroceryItem = async (id: number | string) => {
```
```ts
  const updateGroceryItem = async (id: number | string, updates: { name: string; quantity: string; notes: string }) => {
```

`src/hooks/usePantry.ts`:
```ts
  const updatePantryStatus = async (id: number | string, status: "plenty" | "low" | "out") => {
```
```ts
  const removePantryItem = async (id: number | string) => {
```

`src/components/meals/GroceryTab.tsx`:
```ts
  const [editingGroceryId, setEditingGroceryId] = useState<number | string | null>(null);
```
```ts
  const [undo, setUndo] = useState<{ pantryIds: (number | string)[]; items: GroceryItem[]; added: number } | null>(null);
```
```ts
  const saveEdit = (id: number | string) => {
```

`src/components/meals/PantryTab.tsx`:
```ts
  const [pendingDeleteId, setPendingDeleteId] = useState<number | string | null>(null);
```

`src/services/mealSync.ts`:
```ts
  async toggleManualOverride(groceryId: number | string, override: boolean): Promise<void> {
```

- [ ] **Step 6: Run test to verify it passes + typecheck the ripple**

Run: `npx vitest run tests/unit/pb-db-grocery.test.ts` — Expected: 5/5 PASS.
Run: `npm run typecheck` — Expected: clean. If the widened id surfaces further errors (e.g. a component comparing ids), fix mechanically with `number | string`.

- [ ] **Step 7: Commit**

```bash
git add src/types/meals.ts src/db/pb-db.ts src/hooks/useGrocery.ts src/hooks/usePantry.ts src/components/meals/GroceryTab.tsx src/components/meals/PantryTab.tsx src/services/mealSync.ts tests/unit/pb-db-grocery.test.ts
git commit -m "fix(kitchen): id-first grocery upsert + widened item ids (BUG-2/3 foundation)"
```

---

### Task 2: grocery-service returns real PB records + parseQuantityString

**Files:**
- Modify: `src/lib/grocery-service.ts:20-76`
- Test: `tests/unit/grocery-service.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's id-first `db.upsertGroceryItem` (returns the real PB record with its string `id`)
- Produces:
  - `upsertGroceryItem(input): Promise<GroceryItem>` — `.id` is the real PB record id; falls back to `Date.now()` only when PB is unreachable (offline mode keeps working)
  - `parseQuantityString(qty: string): { quantityValue?: number; unit?: string }` — `"2"` → `{quantityValue: 2}`, `"1.5 lb"` → `{quantityValue: 1.5, unit: "lb"}`, `""` → `{}`. Task 5 uses this at the pantry handoff.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[] };
  const collectionMock = {
    getFullList: async () => state.records.map(r => ({ ...r })),
    create: async (data: any) => {
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      const rec = state.records.find(r => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
  };
  return { state, collectionMock };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => h.collectionMock }),
  getAdminPB: () => ({ collection: () => h.collectionMock, autoCancellation: () => {} }),
}));

import { upsertGroceryItem, parseQuantityString } from "@/lib/grocery-service";

describe("parseQuantityString", () => {
  it("parses a bare number", () => {
    expect(parseQuantityString("2")).toEqual({ quantityValue: 2 });
  });
  it("parses number + unit", () => {
    expect(parseQuantityString("1.5 lb")).toEqual({ quantityValue: 1.5, unit: "lb" });
  });
  it("returns empty object for empty/whitespace input", () => {
    expect(parseQuantityString("")).toEqual({});
    expect(parseQuantityString("   ")).toEqual({});
  });
  it("returns unit-only when there is no leading number", () => {
    expect(parseQuantityString("a dozen")).toEqual({});
  });
});

describe("upsertGroceryItem real ids", () => {
  beforeEach(() => { h.state.records = []; });

  it("returns the real PB record id for a new item", async () => {
    const item = await upsertGroceryItem({ name: "Milk", category: "dairy" });
    expect(item.id).toBe("pb_1");
    expect(item.name).toBe("Milk");
    expect(item.needed).toBe(true);
  });

  it("reuses the existing PB record id for a duplicate name", async () => {
    const first = await upsertGroceryItem({ name: "Eggs", category: "dairy" });
    const second = await upsertGroceryItem({ name: "eggs", category: "dairy", quantity: "12" });
    expect(second.id).toBe(first.id);
    expect(h.state.records).toHaveLength(1);
    expect(second.quantity).toBe("12");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/grocery-service.test.ts`
Expected: FAIL — `parseQuantityString` is not exported ("No matching export"), and "returns the real PB record id" fails (current code returns `Date.now()`).

- [ ] **Step 3: Implement**

Replace `src/lib/grocery-service.ts` entirely with:

```ts
import { db } from "@/db";
import { GroceryItem } from "@/types/meals";
import { groceryCategories } from "@/data/meals";

export interface GroceryInput {
  name: string;
  category?: string;
  aisle?: string;
  quantity?: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
  needed?: boolean;
  source?: string;
  autoGenerated?: boolean;
  emoji?: string;
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function parseQuantityString(qty: string): { quantityValue?: number; unit?: string } {
  const trimmed = (qty || "").trim();
  if (!trimmed) return {};
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return {};
  const quantityValue = parseFloat(match[1]);
  const unit = match[2].trim() || undefined;
  return { quantityValue, ...(unit ? { unit } : {}) };
}

export async function upsertGroceryItem(input: GroceryInput): Promise<GroceryItem> {
  const trimmed = input.name.trim();
  const category = input.category || "pantry";
  const catDef = groceryCategories.find(c => c.id === category);
  const itemEmoji = input.emoji || catDef?.emoji || "📦";
  const aisle = input.aisle || catDef?.aisles?.[0]?.split('-')[0] || "1";
  const quantity = input.quantity?.trim() || "";
  const notes = input.notes?.trim() || "";
  const priority = input.priority || "medium";
  const source = input.source || "manual";
  const autoGenerated = input.autoGenerated ?? false;

  const raw = await db.selectGrocery();
  const existing = raw.find((g: any) => g.name && normalizeName(g.name) === normalizeName(trimmed));

  if (existing) {
    const quantityFinal = quantity || existing.quantity || "";
    const notesFinal = notes || existing.notes || "";
    const saved: any = await db.upsertGroceryItem({ ...existing, needed: true, quantity: quantityFinal, notes: notesFinal });
    const id = saved?.id ?? existing.id;
    return {
      id,
      name: existing.name || trimmed,
      emoji: existing.emoji || itemEmoji,
      category: existing.category || category,
      aisle: existing.aisle || aisle,
      quantity: quantityFinal,
      notes: notesFinal,
      priority: existing.priority || priority,
      needed: true,
      manualOverride: existing.manualOverride,
      lastSyncedAt: existing.lastSyncedAt,
      source: existing.source || source,
      autoGenerated: existing.autoGenerated ?? autoGenerated,
      quantityValue: existing.quantityValue,
      unit: existing.unit,
      pinned: existing.pinned,
      userId: existing.userId,
      updatedAt: existing.updatedAt,
    };
  }

  const saved: any = await db.upsertGroceryItem({ name: trimmed, category, aisle, quantity, notes, priority, needed: true, source, autoGenerated, emoji: itemEmoji });
  return {
    id: saved?.id ?? Date.now(),
    name: trimmed,
    emoji: itemEmoji,
    category,
    aisle,
    quantity,
    notes,
    priority,
    needed: true,
    source,
    autoGenerated,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/grocery-service.test.ts` — Expected: 6/6 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grocery-service.ts tests/unit/grocery-service.test.ts
git commit -m "fix(kitchen): grocery-service returns real PB ids + parseQuantityString (BUG-2)"
```

---

### Task 3: useGrocery — real ids in state, loaded-gated persistence, skipRecent, override toggle

**Files:**
- Modify: `src/hooks/useGrocery.ts:40-141` (init effect, persistence effect, `addGroceryItem`), add `toggleManualOverride`
- Test: `tests/unit/use-grocery.test.tsx` (create)

**Interfaces:**
- Consumes: Task 2's `upsertGroceryItem` (real PB ids)
- Produces:
  - `addGroceryItem(name, category, priority, emojiOverride?, quantity?, notes?, silent?, skipRecent?)` — 8th param `skipRecent` skips the Recently-Bought push (undo uses it; **BUG-6**)
  - `toggleManualOverride(id: number | string)` — flips `manualOverride` in PB + state with a 📌/🔓 toast (Task 7 UI consumes it)
  - localStorage `consuela-grocery` is written **only after init completes** and **even when empty** (**BUG-5**)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-grocery.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => {
      const byId = item.id != null ? h.state.grocery.find(g => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.state.grocery.find(g => g.name?.toLowerCase() === item.name?.toLowerCase());
      const { id: _omit, ...data } = item;
      if (existing) { Object.assign(existing, data); return { ...existing }; }
      const rec = { id: `pb_${h.state.grocery.length + 1}`, ...data };
      h.state.grocery.push(rec);
      return { ...rec };
    },
    deleteGroceryItem: async (id: any) => {
      const idx = h.state.grocery.findIndex(g => String(g.id) === String(id));
      if (idx === -1) return false;
      h.state.grocery.splice(idx, 1);
      return true;
    },
    toggleGroceryOverride: async (id: any, override: boolean) => {
      const rec = h.state.grocery.find(g => String(g.id) === String(id));
      if (!rec) return null;
      rec.manualOverride = override;
      return { ...rec };
    },
  },
}));

import { useGrocery } from "@/hooks/useGrocery";

let hookResult: any;
function Harness() {
  hookResult = useGrocery(() => {});
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

describe("useGrocery", () => {
  beforeEach(() => {
    h.state.grocery = [];
    localStorage.clear();
    hookResult = null;
  });

  it("hydrates state with real PB string ids", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    expect(hookResult.groceryItems[0].id).toBe("pb_1");
  });

  it("addGroceryItem appends with the real PB id (BUG-2)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.addGroceryItem("Bread", "pantry", "medium"); });
    const bread = hookResult.groceryItems.find((i: any) => i.name === "Bread");
    expect(bread.id).toBe("pb_2");
    expect(h.state.grocery).toHaveLength(2);
  });

  it("deleteGroceryItem removes the real PB record and the state row (BUG-2)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.deleteGroceryItem("pb_1"); });
    expect(h.state.grocery).toHaveLength(0);
    expect(hookResult.groceryItems).toHaveLength(0);
  });

  it("persists an empty list after the last item is deleted (BUG-5)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.deleteGroceryItem("pb_1"); });
    expect(localStorage.getItem("consuela-grocery")).toBe("[]");
  });

  it("skipRecent add does not touch Recently Bought (BUG-6)", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.addGroceryItem("Undo Item", "pantry", "medium", undefined, "", "", true, true); });
    expect(hookResult.recentlyBought.some((r: any) => r.name === "Undo Item")).toBe(false);
    await act(async () => { await hookResult.addGroceryItem("Normal Item", "pantry", "medium"); });
    expect(hookResult.recentlyBought.some((r: any) => r.name === "Normal Item")).toBe(true);
  });

  it("toggleManualOverride flips the flag in state and PB", async () => {
    h.state.grocery.push({ id: "pb_1", name: "Milk", category: "dairy", needed: true });
    await mount();
    await act(async () => { await hookResult.toggleManualOverride("pb_1"); });
    expect(hookResult.groceryItems[0].manualOverride).toBe(true);
    expect(h.state.grocery[0].manualOverride).toBe(true);
    await act(async () => { await hookResult.toggleManualOverride("pb_1"); });
    expect(hookResult.groceryItems[0].manualOverride).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-grocery.test.tsx`
Expected: FAIL — "addGroceryItem appends with the real PB id" (state keeps the local fake id), "persists an empty list" (empty lists are never written), "skipRecent" (8th param ignored), "toggleManualOverride" (not a function).

- [ ] **Step 3: Implement**

In `src/hooks/useGrocery.ts`:

a) Add the `loaded` gate next to the other `useState` lines:

```ts
  const [loaded, setLoaded] = useState(false);
```

b) Init effect — set `loaded` in both branches (inside the `.then` after `setGroceryItems(...)`, and in the `.catch` after its `setGroceryItems(...)`):

```ts
      setLoaded(true);
```

c) Replace the persistence effect (lines 102-104):

```ts
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(GROCERY_KEY, JSON.stringify(groceryItems));
  }, [groceryItems, loaded]);
```

d) Replace `addGroceryItem` (lines 110-141):

```ts
  const addGroceryItem = async (
    name: string,
    category: string,
    priority: "low" | "medium" | "high",
    emojiOverride?: string,
    quantity = "",
    notes = "",
    silent = false,
    skipRecent = false
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return false;

    const existing = groceryItems.find(i => normalizeName(i.name) === normalizeName(trimmed));
    const item = await upsertGroceryItem({ name: trimmed, category, priority, emoji: emojiOverride, quantity, notes });

    setGroceryItems(prev => {
      const idx = prev.findIndex(i => normalizeName(i.name) === normalizeName(trimmed));
      if (idx === -1) return [...prev, item];
      const next = [...prev];
      next[idx] = { ...next[idx], ...item, quantity: quantity || next[idx].quantity, notes: notes || next[idx].notes };
      return next;
    });

    if (!skipRecent) {
      setRecentlyBought(prev => {
        const filtered = prev.filter(r => normalizeName(r.name) !== normalizeName(trimmed));
        return [{ name: trimmed, emoji: item.emoji || "📦", category: item.category }, ...filtered].slice(0, 8);
      });
    }
    if (!silent) showToast(existing ? `🛒 ${trimmed} is already on your list` : `🛒 Added ${trimmed}`);
    return true;
  };
```

e) Add `toggleManualOverride` after `updateGroceryItem`:

```ts
  const toggleManualOverride = async (id: number | string) => {
    const item = groceryItems.find(i => i.id === id);
    if (!item) return;
    const next = !item.manualOverride;
    await db.toggleGroceryOverride(id, next);
    setGroceryItems(prev => prev.map(i => i.id === id ? { ...i, manualOverride: next } : i));
    showToast(next ? `📌 ${item.name} locked from auto-sync` : `🔓 ${item.name} unlocked for auto-sync`);
  };
```

f) Add `toggleManualOverride` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/use-grocery.test.tsx` — Expected: 6/6 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGrocery.ts tests/unit/use-grocery.test.tsx
git commit -m "fix(kitchen): useGrocery real ids, empty-list persistence, skipRecent, override toggle (BUG-2/5/6)"
```

---

### Task 4: usePantry — quantity/unit + silent opts, loaded-gated persistence, delete dead code

**Files:**
- Modify: `src/hooks/usePantry.ts` (delete `mergePantryWithDb` lines 16-26; init map; persistence effect; `addPantryItem`)
- Test: `tests/unit/use-pantry.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1's widened `PantryItem.id`
- Produces: `addPantryItem(name, status, opts?: { quantity?: number; unit?: string; silent?: boolean })` — returns the created `PantryItem` (with real PB id) or `false`. `silent` suppresses the per-item toast (**BUG-7**); `quantity`/`unit` are persisted (**BUG-4**). Pantry localStorage is loaded-gated and written even when empty (**BUG-5**).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-pantry.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const h = vi.hoisted(() => ({ state: { pantry: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    upsertPantryItem: async (item: any) => {
      const existing = h.state.pantry.find(p => (p.item || p.name)?.toLowerCase() === item.name?.toLowerCase());
      if (existing) { Object.assign(existing, item, { item: item.name }); return { ...existing }; }
      const rec = { id: `pp_${h.state.pantry.length + 1}`, ...item, item: item.name };
      h.state.pantry.push(rec);
      return { ...rec };
    },
    deletePantryItem: async (id: any) => {
      const idx = h.state.pantry.findIndex(p => String(p.id) === String(id));
      if (idx === -1) return false;
      h.state.pantry.splice(idx, 1);
      return true;
    },
  },
}));

import { usePantry } from "@/hooks/usePantry";

let hookResult: any;
const toasts: string[] = [];
function Harness() {
  hookResult = usePantry((msg: string) => toasts.push(msg));
  return null;
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<Harness />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

describe("usePantry", () => {
  beforeEach(() => {
    h.state.pantry = [];
    localStorage.clear();
    hookResult = null;
    toasts.length = 0;
  });

  it("addPantryItem persists quantity and unit (BUG-4)", async () => {
    await mount();
    let saved: any;
    await act(async () => { saved = await hookResult.addPantryItem("Milk", "plenty", { quantity: 2, unit: "lb" }); });
    expect(saved.id).toBe("pp_1");
    expect(h.state.pantry[0].quantity).toBe(2);
    expect(h.state.pantry[0].unit).toBe("lb");
  });

  it("silent mode fires no toast (BUG-7)", async () => {
    await mount();
    await act(async () => { await hookResult.addPantryItem("Milk", "plenty", { silent: true }); });
    expect(toasts).toHaveLength(0);
    await act(async () => { await hookResult.addPantryItem("Eggs", "plenty"); });
    expect(toasts).toHaveLength(1);
  });

  it("persists an empty pantry after the last item is removed (BUG-5)", async () => {
    h.state.pantry.push({ id: "pp_1", name: "Milk", item: "Milk", status: "plenty" });
    await mount();
    await act(async () => { await hookResult.removePantryItem("pp_1"); });
    expect(localStorage.getItem("consuela-pantry")).toBe("[]");
  });

  it("removePantryItem works with PB string ids", async () => {
    h.state.pantry.push({ id: "pp_1", name: "Milk", item: "Milk", status: "plenty" });
    await mount();
    await act(async () => { await hookResult.removePantryItem("pp_1"); });
    expect(h.state.pantry).toHaveLength(0);
    expect(hookResult.pantryItems).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-pantry.test.tsx`
Expected: FAIL — quantity/unit not persisted (opts param doesn't exist), silent toast still fires, empty list not written.

- [ ] **Step 3: Implement**

In `src/hooks/usePantry.ts`:

a) Delete the entire `mergePantryWithDb` function (lines 16-26) — dead code with a `Number(item.id)` NaN landmine (**BUG-8**).

b) Add the loaded gate:

```ts
  const [loaded, setLoaded] = useState(false);
```

c) Init effect — carry quantity/unit through the PB map and set `loaded` in both branches:

```ts
  useEffect(() => {
    const local = loadJSON<PantryItem[]>(PANTRY_KEY, []);
    db.selectPantry().then((pbRaw: any) => {
      const pbData = pbRaw.map((p: any) => ({ id: p.id, item: p.name || p.item, status: p.status, quantity: p.quantity, unit: p.unit }));
      if (pbData.length > 0) {
        const merged = [...pbData];
        const pbIds = new Set(pbData.map((p: PantryItem) => String(p.id)));
        const pbNames = new Set(pbData.map((p: PantryItem) => normalizeName(p.item)));
        for (const item of local) {
          if (!pbIds.has(String(item.id)) && !pbNames.has(normalizeName(item.item))) {
            merged.push(item);
          }
        }
        setPantryItems(merged);
      } else {
        setPantryItems(local.length > 0 ? local : pbData);
      }
      setLoaded(true);
    }).catch(() => {
      setPantryItems(local.length > 0 ? local : []);
      setLoaded(true);
    });
  }, []);
```

d) Replace the persistence effect:

```ts
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(PANTRY_KEY, JSON.stringify(pantryItems));
  }, [pantryItems, loaded]);
```

e) Replace `addPantryItem`:

```ts
  const addPantryItem = async (
    name: string,
    status: "plenty" | "low" | "out",
    opts: { quantity?: number; unit?: string; silent?: boolean } = {}
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const exists = pantryItems.some(p => normalizeName(p.item) === normalizeName(trimmed));
    if (exists) { if (!opts.silent) showToast("Item already in pantry"); return false; }
    const alreadyOnGrocery = groceryItems.some(g => normalizeName(g.name) === normalizeName(trimmed) && g.needed);
    const saved = await db.upsertPantryItem({ userId: "demo", name: trimmed, status, quantity: opts.quantity, unit: opts.unit });
    if (!saved) { if (!opts.silent) showToast("❌ Failed to save item to pantry"); return false; }
    const newItem: PantryItem = {
      id: saved.id ?? Date.now(),
      item: saved.name || saved.item,
      status: saved.status,
      quantity: opts.quantity,
      unit: opts.unit,
    };
    setPantryItems(prev => [...prev, newItem]);
    if (!opts.silent) showToast(alreadyOnGrocery ? `🥫 Added ${trimmed} to pantry and grocery` : `🥫 Added ${trimmed} to pantry`);
    return newItem;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/use-pantry.test.tsx` — Expected: 4/4 PASS.
Run: `npm run typecheck` — Expected: clean. Note: `PantryTab.tsx:77` does `const success = addPantryItem(...)` and checks `success !== false` — still valid.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePantry.ts tests/unit/use-pantry.test.tsx
git commit -m "fix(kitchen): usePantry quantity/unit + silent opts, empty-list persistence, drop dead merge (BUG-4/5/7/8)"
```

---

### Task 5: Decouple the handoff — checked rows ALWAYS leave the list (BUG-1 + BUG-4 + BUG-7)

**Files:**
- Modify: `src/components/meals/GroceryTab.tsx:89-141` (`sendSingleToPantry`, `sendCheckedToPantry`), `:143-158` (`handleUndo`)
- Test: `tests/unit/grocery-handoff.test.tsx` (create)

**Interfaces:**
- Consumes: Task 3's `addGroceryItem(..., silent, skipRecent)`, Task 4's `addPantryItem(name, status, { quantity, unit, silent })`, Task 2's `parseQuantityString`
- Produces: the core contract change — **"Send to pantry" always removes checked grocery rows.** Items already in the pantry are counted as "already there" but their grocery rows are still deleted. Quantity/unit travel into the pantry. Bulk send uses `silent` pantry adds (one summary toast only). Undo re-adds with `skipRecent`.

**The new rule (matches MealBoard/AnyList):** buying an item and removing it from the list must never depend on whether the pantry write succeeds or whether the item was already tracked.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-handoff.test.tsx`. This test renders `GroceryTab` with stub props and drives the bulk-send handler:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import GroceryTab from "@/components/meals/GroceryTab";

function makeProps(overrides: any = {}) {
  const calls = { addPantry: [] as any[], deleteGrocery: [] as any[], addGrocery: [] as any[], removePantry: [] as any[], toasts: [] as string[] };
  const props = {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: false, quantity: "2 lb" },
      { id: "g2", name: "Bread", emoji: "🍞", category: "pantry", priority: "medium", needed: false },
      { id: "g3", name: "Keep Me", emoji: "🧀", category: "dairy", priority: "medium", needed: true },
    ],
    activeCategory: "all",
    setActiveCategory: () => {},
    isSyncing: false,
    recentlyBought: [],
    clearRecentlyBought: () => {},
    addGroceryItem: async (...args: any[]) => { calls.addGrocery.push(args); return true; },
    toggleGroceryNeeded: async () => {},
    deleteGroceryItem: async (id: any) => { calls.deleteGrocery.push(id); },
    updateGroceryItem: async () => {},
    syncMealToGrocery: async () => {},
    syncPantryToGrocery: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: (m: string) => calls.toasts.push(m),
    pantryItems: [{ id: "p1", item: "Milk", status: "plenty" }],
    addPantryItem: async (name: string, status: string, opts: any) => { calls.addPantry.push({ name, status, opts }); return { id: `new_${name}`, item: name, status }; },
    removePantryItem: async (id: any) => { calls.removePantry.push(id); },
    ...overrides,
  };
  return { props, calls };
}

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<GroceryTab {...props} />); });
  return el;
}

function findButton(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find(b => text.test(b.textContent || ""));
  if (!btn) throw new Error(`button ${text} not found`);
  return btn as HTMLButtonElement;
}

describe("GroceryTab checked→pantry handoff", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("bulk send deletes ALL checked rows, including ones already in the pantry (BUG-1)", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.deleteGrocery.sort()).toEqual(["g1", "g2"]);
    expect(calls.addPantry.map(c => c.name)).toEqual(["Bread"]);
    expect(calls.toasts.join(" ")).toMatch(/1 of 2/);
  });

  it("carries parsed quantity and unit into the pantry add (BUG-4)", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    const bread = calls.addPantry.find(c => c.name === "Bread");
    expect(bread.opts).toMatchObject({ silent: true });
    const milkRow = props.groceryItems[0];
    expect(milkRow.quantity).toBe("2 lb");
  });

  it("bulk pantry adds are silent — exactly one summary toast (BUG-7)", async () => {
    const { props, calls } = makeProps({ pantryItems: [] });
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.addPantry.every(c => c.opts?.silent === true)).toBe(true);
    expect(calls.toasts).toHaveLength(1);
  });

  it("undo re-adds rows with skipRecent and removes the created pantry items", async () => {
    const { props, calls } = makeProps({ pantryItems: [] });
    const root = await render(props);
    const sendBtn = findButton(root, /Send 2 to pantry/);
    await act(async () => { sendBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    const undoBtn = findButton(root, /^Undo$/);
    await act(async () => { undoBtn.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(calls.removePantry).toHaveLength(2);
    expect(calls.addGrocery).toHaveLength(2);
    expect(calls.addGrocery.every(args => args[7] === true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/grocery-handoff.test.tsx`
Expected: FAIL — "bulk send deletes ALL checked rows" fails (current code skips `g1` because Milk is already in the pantry, so `deleteGrocery` only gets `g2`), silent opts missing, undo skipRecent arg missing.

- [ ] **Step 3: Implement**

In `src/components/meals/GroceryTab.tsx`:

a) Add the import at the top (after the existing imports):

```ts
import { parseQuantityString } from "@/lib/grocery-service";
```

b) Replace `sendSingleToPantry` (lines 89-104):

```ts
  const sendSingleToPantry = async (item: GroceryItem) => {
    if (sending) return;
    setSending(true);
    try {
      const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
      const { quantityValue, unit } = parseQuantityString(item.quantity || "");
      if (!inPantry) {
        const saved: any = await addPantryItem(item.name, "plenty", { quantity: quantityValue, unit, silent: true });
        if (!saved) {
          showToast(`❌ Couldn't add ${item.name} to pantry — it stays on your list`);
          return;
        }
        pushUndo({ pantryIds: [saved.id], items: [item], added: 1 });
      }
      await deleteGroceryItem(item.id);
      showToast(inPantry ? `🥫 ${item.name} was already stocked — removed from your list` : `🥫 Sent ${item.name} to pantry`);
    } finally {
      setSending(false);
    }
  };
```

c) Replace `sendCheckedToPantry` (lines 106-141):

```ts
  const sendCheckedToPantry = async () => {
    if (sending) return;
    const checked = groceryItems.filter((i: any) => !i.needed);
    if (!checked.length) return;
    setSending(true);
    try {
      const pantryIds: (number | string)[] = [];
      const sentItems: GroceryItem[] = [];
      let added = 0;
      let already = 0;
      let failed = 0;
      for (const item of checked) {
        const inPantry = (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(item.name));
        if (inPantry) { already++; continue; }
        const { quantityValue, unit } = parseQuantityString(item.quantity || "");
        const saved: any = await addPantryItem(item.name, "plenty", { quantity: quantityValue, unit, silent: true });
        if (saved && typeof saved === "object") {
          added++;
          pantryIds.push(saved.id);
          sentItems.push(item);
        } else {
          failed++;
        }
      }
      const removable = checked.filter((i: any) =>
        failed === 0 || (pantryItems || []).some((p: any) => normalizeName(p.item || p.name) === normalizeName(i.name)) || sentItems.some(s => s.id === i.id)
      );
      for (const item of removable) await deleteGroceryItem(item.id);
      if (added > 0) pushUndo({ pantryIds, items: sentItems, added });
      if (failed === 0) {
        showToast(already === 0
          ? `🥫 Sent ${added} item${added === 1 ? "" : "s"} to pantry`
          : `🥫 Sent ${added} of ${added + already} to pantry (${already} already stocked)`);
      } else {
        showToast(`🥫 Sent ${added} to pantry (${already} already stocked, ${failed} failed — kept on list)`);
      }
    } finally {
      setSending(false);
    }
  };
```

d) In `handleUndo` (line 151), pass `silent` + `skipRecent` to the re-add:

```ts
        await addGroceryItem(item.name, item.category, item.priority, item.emoji, item.quantity || "", item.notes || "", true, true);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/grocery-handoff.test.tsx` — Expected: 4/4 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/meals/GroceryTab.tsx tests/unit/grocery-handoff.test.tsx
git commit -m "fix(kitchen): checked items always leave the grocery list; qty carried to pantry; silent bulk adds (BUG-1/4/7)"
```

---

### Task 6: Honest meal-sync updates (BUG-3)

**Files:**
- Modify: `src/services/mealSync.ts:268-275` (`updateGroceryItem`), `:56-63` + `:113-120` + `:141-147` (count only real successes)
- Test: `tests/unit/meal-sync.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's id-first `db.upsertGroceryItem` (an update payload with `id` now reaches the right record even without `name`)
- Produces: `mealSyncService` update paths that actually write to PB and report truthful counts. `syncMealPlanToGrocery` quantity updates and stale-item unchecks work; `syncPantryToGrocery` "plenty → uncheck" works.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/meal-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[], pantry: [] as any[], meals: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    selectMeals: async () => h.state.meals.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => {
      const byId = item.id != null ? h.state.grocery.find(g => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.state.grocery.find(g => g.name?.toLowerCase() === item.name?.toLowerCase());
      const { id: _omit, ...data } = item;
      if (existing) { Object.assign(existing, data); return { ...existing }; }
      if (!data.name) return null;
      const rec = { id: `g_${h.state.grocery.length + 1}`, ...data };
      h.state.grocery.push(rec);
      return { ...rec };
    },
  },
}));

import { mealSyncService } from "@/services/mealSync";

describe("mealSyncService honest updates", () => {
  beforeEach(() => {
    h.state.grocery = [];
    h.state.pantry = [];
    h.state.meals = [];
  });

  it("syncPantryToGrocery unchecks a needed grocery row when pantry has plenty (BUG-3)", async () => {
    h.state.grocery.push({ id: "g_1", name: "Milk", needed: true, source: "meal-plan" });
    h.state.pantry.push({ id: "p_1", name: "Milk", status: "plenty" });
    const result = await mealSyncService.syncPantryToGrocery("demo");
    expect(h.state.grocery[0].needed).toBe(false);
    expect(result.updated).toBe(1);
  });

  it("syncMealPlanToGrocery updates the quantity of an existing auto item (BUG-3)", async () => {
    h.state.grocery.push({ id: "g_1", name: "Chicken breast", needed: true, source: "meal-plan", autoGenerated: true });
    h.state.meals.push({ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 });
    const result = await mealSyncService.syncMealPlanToGrocery("demo");
    expect(h.state.grocery[0].quantity).toBe("3 lb");
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
  });

  it("reports zero updates when nothing matches (no lying counts)", async () => {
    h.state.grocery.push({ id: "g_1", name: "Milk", needed: true, source: "manual" });
    h.state.pantry.push({ id: "p_1", name: "Milk", status: "plenty" });
    const result = await mealSyncService.syncPantryToGrocery("demo");
    expect(result.updated).toBe(0);
    expect(h.state.grocery[0].needed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/meal-sync.test.ts`
Expected: FAIL — "unchecks a needed grocery row" fails (current `updateGroceryItem` sends `{ id, needed, ... }` with no `name`; the mock's name-only fallback can't match, returns null, but the service still counts `updated: 1` while PB state is unchanged).

- [ ] **Step 3: Implement**

In `src/services/mealSync.ts`:

a) Replace `updateGroceryItem` (lines 268-275) — fetch the record, merge, and send the full record so the id-first upsert always has what it needs; return success:

```ts
  private async updateGroceryItem(id: number | string, updates: Partial<GroceryListItem>): Promise<boolean> {
    try {
      const all = await db.selectGrocery();
      const record = all.find((g: any) => String(g.id) === String(id));
      if (!record) return false;
      const saved = await db.upsertGroceryItem({ ...record, ...updates, id: record.id, userId: 'demo' });
      return !!saved;
    } catch (e) {
      console.warn('[MealSync] update failed for id', id, e);
      return false;
    }
  }
```

b) In `syncMealPlanToGrocery`, make both update call-sites count only real successes. Replace lines 56-63:

```ts
          if (existing) {
            const ok = await this.updateGroceryItem(existing.id, {
              quantity: this.formatQuantity(ingredient.quantity, ingredient.unit),
              priority: this.getPriorityForDeficit(ingredient.quantity),
              needed: true,
              lastSyncedAt: new Date().toISOString(),
            });
            if (ok) updated++;
          } else {
```

and lines 80-88 (the stale-item loop):

```ts
      for (const grocery of existingGrocery) {
        if (grocery.manualOverride || this.isManualSource(grocery.source)) continue;
        if (this.shouldKeepMealPlanGrocery(grocery, requiredNames)) continue;
        const ok = await this.updateGroceryItem(grocery.id, {
          needed: false,
          lastSyncedAt: new Date().toISOString(),
        });
        if (ok) removed++;
      }
```

c) In `syncPantryToGrocery`, replace lines 113-120:

```ts
        if (existing) {
          const ok = await this.updateGroceryItem(existing.id, {
            needed: true,
            priority,
            lastSyncedAt: new Date().toISOString(),
            source: 'pantry-check',
          });
          if (ok) updated++;
        } else {
```

and lines 138-148 (the plenty-uncheck loop):

```ts
      for (const grocery of allGrocery) {
        if (grocery.manualOverride || this.isManualSource(grocery.source) || !grocery.needed) continue;
        const pantryStock = this.findPantryStock(pantryItems, grocery.name);
        if (pantryStock && pantryStock.status === 'plenty') {
          const ok = await this.updateGroceryItem(grocery.id, {
            needed: false,
            lastSyncedAt: new Date().toISOString(),
          });
          if (ok) updated++;
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/meal-sync.test.ts` — Expected: 3/3 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/mealSync.ts tests/unit/meal-sync.test.ts
git commit -m "fix(kitchen): meal-sync updates write by id and report honest counts (BUG-3)"
```

---

### Task 7: Manual-override lock UI on grocery rows (unbuilt feature #1)

**Files:**
- Modify: `src/components/meals/GroceryTab.tsx` (row trailing actions, ~lines 521-557)
- Modify: `src/app/meals/page.tsx:90-95,366-386` (pass `toggleManualOverride` through)
- Test: `tests/unit/grocery-override-ui.test.tsx` (create)

**Interfaces:**
- Consumes: Task 3's `toggleManualOverride(id)` from `useGrocery`
- Produces: a 📌 pin button on every grocery row (next to edit/delete). Pinned rows show a filled pin + "locked from auto-sync" tooltip; tapping toggles `manualOverride`, which `mealSyncService` already respects (skips pinned/manual-override rows during sync).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/grocery-override-ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import GroceryTab from "@/components/meals/GroceryTab";

function makeProps(overrides: any = {}) {
  const calls = { toggleOverride: [] as any[] };
  const props = {
    groceryItems: [
      { id: "g1", name: "Milk", emoji: "🥛", category: "dairy", priority: "medium", needed: true, manualOverride: false },
      { id: "g2", name: "Bread", emoji: "🍞", category: "pantry", priority: "medium", needed: true, manualOverride: true },
    ],
    activeCategory: "all",
    setActiveCategory: () => {},
    isSyncing: false,
    recentlyBought: [],
    clearRecentlyBought: () => {},
    addGroceryItem: async () => true,
    toggleGroceryNeeded: async () => {},
    deleteGroceryItem: async () => {},
    updateGroceryItem: async () => {},
    syncMealToGrocery: async () => {},
    syncPantryToGrocery: async () => {},
    parseManualGroceryInput: (s: string) => ({ name: s, quantity: "" }),
    guessCategory: () => "pantry",
    showToast: () => {},
    pantryItems: [],
    addPantryItem: async () => false,
    removePantryItem: async () => {},
    toggleManualOverride: async (id: any) => { calls.toggleOverride.push(id); },
    ...overrides,
  };
  return { props, calls };
}

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<GroceryTab {...props} />); });
  return el;
}

describe("GroceryTab manual-override pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("renders a pin button on every row", async () => {
    const { props } = makeProps();
    const root = await render(props);
    const pins = Array.from(root.querySelectorAll("button")).filter(b => (b.getAttribute("aria-label") || "").includes("lock"));
    expect(pins).toHaveLength(2);
  });

  it("tapping the pin calls toggleManualOverride with the row id", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const pin = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "lock Milk from auto-sync");
    expect(pin).toBeTruthy();
    await act(async () => { (pin as HTMLButtonElement).click(); });
    expect(calls.toggleOverride).toEqual(["g1"]);
  });

  it("shows the locked state for manualOverride rows", async () => {
    const { props } = makeProps();
    const root = await render(props);
    const locked = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "unlock Bread for auto-sync");
    expect(locked).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/grocery-override-ui.test.tsx`
Expected: FAIL — no pin buttons render (0 found).

- [ ] **Step 3: Implement**

a) In `src/components/meals/GroceryTab.tsx`, add `toggleManualOverride` to the destructured props (line ~17-36):

```ts
  toggleManualOverride,
```

b) In the row `trailing` block (lines 521-557), add the pin button inside the hover-revealed action group, before the edit button:

```tsx
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleManualOverride?.(item.id); }}
                                aria-label={item.manualOverride ? `unlock ${item.name} for auto-sync` : `lock ${item.name} from auto-sync`}
                                title={item.manualOverride ? "Locked from auto-sync — tap to unlock" : "Lock from auto-sync"}
                                className={`rounded-xl p-1.5 tap-sm ${
                                  item.manualOverride
                                    ? "opacity-100 text-[var(--color-accent-amber)] bg-[var(--color-accent-amber)]/10"
                                    : "text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text-primary"
                                }`}
                              >
                                <svg viewBox="0 0 24 24" fill={item.manualOverride ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                                  <path d="M12 17v5" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
```

Note: the action group currently uses `opacity-0 group-hover:opacity-100` — a pinned row's pin must stay visible. Change the group wrapper so the pin is outside the hover-only group: place the pin button as a sibling **before** the `<div className="flex gap-1 opacity-0 group-hover:opacity-100 ...">` div, and give the pin `item.manualOverride ? "" : "opacity-0 group-hover:opacity-100"` so locked pins are always visible and unlocked pins appear on hover.

c) In `src/app/meals/page.tsx`, destructure `toggleManualOverride` from `useGrocery` (line ~91-95) and pass it to `<GroceryTab>` (line ~366-386):

```tsx
            toggleManualOverride={toggleManualOverride}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/grocery-override-ui.test.tsx` — Expected: 3/3 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/meals/GroceryTab.tsx src/app/meals/page.tsx tests/unit/grocery-override-ui.test.tsx
git commit -m "feat(kitchen): manual-override pin lock on grocery rows (unbuilt 2026-06-15 feature)"
```

---

### Task 8: CookWithWhatYouHave component (unbuilt feature #2)

**Files:**
- Create: `src/components/meals/CookWithWhatYouHave.tsx`
- Modify: `src/app/meals/page.tsx` (render on Pantry tab)
- Test: `tests/unit/cook-with-what-you-have.test.tsx` (create)

**Interfaces:**
- Consumes: existing `findCookableRecipes(recipes, pantryItems)` from `src/lib/recipe-pantry-match.ts` (already unit-testable, sorts by readiness desc)
- Produces: `<CookWithWhatYouHave recipes={Recipe[]} pantryItems={PantryItem[]} onAddMissing={(ingredients: string[]) => void} />` — shows the top 3 cookable recipes with readiness % and missing ingredients; "Add missing to grocery" button per recipe.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cook-with-what-you-have.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import CookWithWhatYouHave from "@/components/meals/CookWithWhatYouHave";
import type { Recipe, PantryItem } from "@/types/meals";

const recipes: Recipe[] = [
  { id: 1, name: "Pasta", emoji: "🍝", prepTime: "20 min", tags: [], ingredients: ["Pasta", "Tomato sauce", "Parmesan"], instructions: "", servings: 4, calories: 400, createdAt: "" },
  { id: 2, name: "Salad", emoji: "🥗", prepTime: "10 min", tags: [], ingredients: ["Lettuce", "Tomato"], instructions: "", servings: 2, calories: 150, createdAt: "" },
];
const pantry: PantryItem[] = [
  { id: "p1", item: "Pasta", status: "plenty" },
  { id: "p2", item: "Tomato sauce", status: "plenty" },
  { id: "p3", item: "Lettuce", status: "plenty" },
  { id: "p4", item: "Tomato", status: "plenty" },
];

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<CookWithWhatYouHave {...props} />); });
  return el;
}

describe("CookWithWhatYouHave", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("ranks recipes by readiness and shows percentages", async () => {
    const root = await render({ recipes, pantryItems: pantry, onAddMissing: () => {} });
    const text = root.textContent || "";
    expect(text).toContain("Salad");
    expect(text).toContain("100%");
    expect(text).toContain("Pasta");
    expect(text).toContain("67%");
  });

  it("lists missing ingredients for partial matches", async () => {
    const root = await render({ recipes, pantryItems: pantry, onAddMissing: () => {} });
    expect(root.textContent).toContain("Parmesan");
  });

  it("fires onAddMissing with the missing ingredient names", async () => {
    const onAddMissing = vi.fn();
    const root = await render({ recipes, pantryItems: pantry, onAddMissing });
    const btn = Array.from(root.querySelectorAll("button")).find(b => /Add missing/i.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    await act(async () => { (btn as HTMLButtonElement).click(); });
    expect(onAddMissing).toHaveBeenCalledWith(["Parmesan"]);
  });

  it("renders an empty state when no recipes have ingredients", async () => {
    const root = await render({ recipes: [], pantryItems: pantry, onAddMissing: () => {} });
    expect(root.textContent).toMatch(/no recipes/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cook-with-what-you-have.test.tsx`
Expected: FAIL — module `@/components/meals/CookWithWhatYouHave` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/meals/CookWithWhatYouHave.tsx`:

```tsx
"use client";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import { findCookableRecipes } from "@/lib/recipe-pantry-match";
import type { Recipe, PantryItem } from "@/types/meals";

interface Props {
  recipes: Recipe[];
  pantryItems: PantryItem[];
  onAddMissing: (ingredients: string[]) => void;
}

export default function CookWithWhatYouHave({ recipes, pantryItems, onAddMissing }: Props) {
  const cookable = findCookableRecipes(recipes, pantryItems).slice(0, 3);

  if (cookable.length === 0) {
    return (
      <SectionCard title="Cook with what you have" icon="🍳" description="Based on your pantry">
        <p className="text-sm text-text-muted">No recipes with ingredients yet — add some in the Recipes tab.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Cook with what you have" icon="🍳" description="Ranked by pantry readiness">
      <div className="space-y-3">
        {cookable.map(({ recipe, readiness }) => (
          <div key={recipe.id} className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>{recipe.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text-primary truncate">{recipe.name}</p>
                <p className="text-[11px] font-semibold text-text-muted">
                  {readiness.readyPct}% ready · {readiness.total - readiness.missing.length}/{readiness.total} ingredients
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                readiness.readyPct === 100
                  ? "bg-[var(--color-accent-mint)]/15 text-[var(--color-accent-mint)]"
                  : "bg-[var(--color-accent-amber)]/15 text-[var(--color-accent-amber)]"
              }`}>
                {readiness.readyPct === 100 ? "Cook now" : "Almost"}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent-mint)] transition-all duration-500"
                style={{ width: `${readiness.readyPct}%` }}
              />
            </div>
            {readiness.missing.length > 0 && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                  Missing: {readiness.missing.join(", ")}
                </p>
                <SoftButton variant="ghost" size="sm" onClick={() => onAddMissing(readiness.missing)}>
                  Add missing
                </SoftButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 4: Wire into the Pantry tab**

In `src/app/meals/page.tsx`:

a) Add the import:

```tsx
import CookWithWhatYouHave from "@/components/meals/CookWithWhatYouHave";
```

b) Add a handler near the other grocery helpers (after `addRecipeToGrocery`):

```tsx
  const addMissingToGrocery = async (ingredients: string[]) => {
    for (const ing of ingredients) {
      const category = guessGroceryCategory(ing);
      await addGroceryItem(ing, category, "medium", undefined, "", "", true);
    }
    showToast(`🛒 Added ${ingredients.length} missing item${ingredients.length === 1 ? "" : "s"} to grocery`);
  };
```

c) In the Pantry tab block (`activeTab === "pantry"`), render it after `<PantryTab>`:

```tsx
        {activeTab === "pantry" && (
          <>
            <PantryTab
              pantryItems={pantryItems}
              groceryItems={groceryItems}
              addPantryItem={addPantryItem}
              updatePantryStatus={updatePantryStatus}
              removePantryItem={removePantryItem}
              syncPantryToGrocery={syncPantryToGrocery}
              isSyncing={isSyncing}
            />
            <div className="mt-6">
              <CookWithWhatYouHave recipes={recipes} pantryItems={pantryItems} onAddMissing={addMissingToGrocery} />
            </div>
          </>
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/cook-with-what-you-have.test.tsx` — Expected: 4/4 PASS.
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/meals/CookWithWhatYouHave.tsx src/app/meals/page.tsx tests/unit/cook-with-what-you-have.test.tsx
git commit -m "feat(kitchen): CookWithWhatYouHave pantry-ranked recipes on Pantry tab (unbuilt MEAL_SYSTEM_ARCHITECTURE §6)"
```

---

### Task 9: Full verification + AGENTS.md update

**Files:**
- Modify: `AGENTS.md` (snapshot + UI Change Record + Change Log)

**Interfaces:**
- Consumes: all prior tasks complete and committed
- Produces: green full-suite verification and the mandatory AGENTS.md documentation per repo convention.

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npm run lint
npx vitest run
npm run build
```

Expected:
- `typecheck`: clean
- `lint`: 0 errors (pre-existing warnings OK)
- `vitest`: all unit tests pass; the only failure allowed is the pre-existing `tests/integration/api-routes.test.ts` (needs PB env vars)
- `build`: clean

If any fail, fix before proceeding.

- [ ] **Step 2: Update AGENTS.md**

Add a new "Last Updated" line at the top of "Current Dashboard Snapshot":

```markdown
- **Last Updated:** 2026-08-21 | **Grocery↔Pantry sync repaired + pantry-aware cooking** — fixed the grocery→pantry handoff so checked items always leave the list (items already stocked are removed, not stuck); fixed the fake-id bug that made deleted grocery rows resurrect on reload; meal-sync updates now write by id with honest toast counts; quantity/unit now carry into the pantry; empty lists persist; new 📌 manual-override pin locks grocery rows from auto-sync; new "Cook with what you have" card on the Pantry tab ranks recipes by pantry readiness with one-tap "Add missing" to grocery.
```

Add a UI Change Record section (follow the exact format of existing records) documenting: files changed, the BUG-1..8 fixes, the two new features, and a user-facing description. Add a matching Change Log entry.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: grocery-pantry sync repair + CookWithWhatYouHave (AGENTS.md)"
```

---

## Self-Review Notes

- **Spec coverage:** BUG-1→Task 5, BUG-2→Tasks 1-3, BUG-3→Tasks 1+6, BUG-4→Tasks 4-5, BUG-5→Tasks 3-4, BUG-6→Task 3, BUG-7→Tasks 4-5, BUG-8→Task 4, manual-override→Task 7, CookWithWhatYouHave→Task 8, docs→Task 9. All covered.
- **Type consistency:** `id: number | string` used consistently; `addPantryItem(name, status, opts)` signature matches across Tasks 4/5; `parseQuantityString` defined in Task 2, consumed in Task 5; `toggleManualOverride` defined in Task 3, consumed in Task 7.
- **Ordering:** Task 1 (types) must precede all others; Task 2 before Task 5; Task 3 before Tasks 5/7; Task 4 before Task 5. Tasks 6, 7, 8 are independent once their deps land.
