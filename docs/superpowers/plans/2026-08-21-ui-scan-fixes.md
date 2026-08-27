# UI Scan Fixes Plan — 2026-08-21

Branch: `ui-scan-fixes` (local only; push after user visual approval).
Source findings: `.superpowers/ui-scan/{kitchen,home-nav,secondary-pages,static-audit,recipe-import-research}.md`

## Global Constraints
- Kitchen tabs (Meals/Grocery/Pantry/Recipes) are calm input surfaces: NO new float/bob/scale animations there. Use existing `.tap`/`.tap-sm` classes for interactive feedback.
- Reuse existing design tokens (`--color-*`), WidgetCard/SectionCard/Modal/SoftButton/TextField patterns.
- Never commit secrets; TheMealDB test key "1" is public by design (not a secret).
- Do NOT touch the uncommitted foreign changes (AGENTS.md, public/version.json, src/app/calendar/page.tsx, src/app/page.tsx) — stage only files each task owns.
- Every task: `npm run typecheck` clean + 0 new lint errors in changed files + relevant vitest passing. Commit per task on `ui-scan-fixes`.
- AGENTS.md update happens in the final task (do not edit it in other tasks — it has foreign uncommitted edits).

## Task 1: Ghost member repair + Who's-eating alignment
Files: `src/components/meals/MealsTab.tsx`, `src/lib/pb-seed.ts` (or a one-off repair script run against live PB), possibly `src/db/pb-db.ts`
- Repair the ghost member row in PocketBase `members` collection (id `gakuxn7ya1wi78i`, empty name/role/emoji): delete it via admin SDK (PB_ADMIN_EMAIL/PB_ADMIN_PASS env). Add a guard in seed/load path that skips members with empty names so it can't recur (`selectMembersDetailed` / members mapping).
- Who's-eating widget (MealsTab.tsx ~648-720): fixed-width columns per member (e.g. w-16) so avatar centers align regardless of name length; names truncate with ellipsis; align the ＋ add button vertically with avatar centers (items-center on a row where buttons have equal height); remove/neutralize unsynchronized popBounce on these avatars (calm surface). Keep tap toggle behavior + aria-labels.
- Verify in browser at 390/768/1440: avatar centers on even steps, ＋ aligned, no nameless avatar, count correct.

## Task 2: Grocery row actions visible on touch
Files: `src/components/meals/GroceryTab.tsx`
- Pin 📌 / edit / delete buttons currently `opacity-0 group-hover:opacity-100` (~line 552-563): invisible on touch. Make them always visible at reduced opacity (e.g. `opacity-60 hover:opacity-100 focus-visible:opacity-100`) or fully visible; keep compact. No layout shift.
- Also fix "Missing: …" truncation in CookWithWhatYouHave.tsx at ≤390px (wrap instead of truncate so ingredients are readable).

## Task 3: /emergency contacts endpoint
Files: `src/app/emergency/page.tsx`, new `src/app/api/emergency-contacts/route.ts` (or repoint page to existing source)
- Page fetches `/api/emergency-contacts` which 404s. Add the GET route returning configured emergency contacts from PB (db.selectEmergencyContacts or equivalent in src/db), sanitized (names, relation, phone, email, isPrimary). Match the shape the page expects. Verify page renders contacts at 390/1440.

## Task 4: Web Import overhaul (modal + extraction hardening)
Files: `src/components/meals/RecipesTab.tsx`, `src/app/meals/page.tsx`, `src/app/api/recipes/ingest/route.ts`, new `src/components/meals/RecipeImportModal.tsx`
- Replace `window.prompt()` with RecipeImportModal: URL input + paste-from-clipboard button, progress states (fetching → extracting → preview), preview/edit screen before save (name, image, servings, times, ingredients textarea, instructions), Save/Cancel. Also a "Paste recipe text" tab using the existing type:"text" ingest path.
- Ingest route hardening: `res.ok` check (surface 403/429 as friendly errors), parse ALL LD+JSON script blocks + `@graph` arrays (not just first), extract image/cookTime/prepTime/totalTime/yield/sourceUrl into the Recipe, size cap on fetch body, deterministic no-LLM fast path when LD+JSON Recipe found (LLM fallback only when extraction fails, and a graceful error toast when LLM unavailable instead of "did not return a recipe action").
- Dedupe by source URL (if recipe with same sourceUrl exists, offer to open it instead of duplicating).

## Task 5: TheMealDB search integration
Files: new `src/lib/themealdb.ts`, `src/app/api/recipes/search/route.ts`, RecipeImportModal or new SearchModal in RecipesTab
- TheMealDB free API (test key "1", no signup): search endpoint `search.php?s=` + lookup `lookup.php?i=`. Server route proxies search (keep key server-side), returns name/thumb/instructions/ingredients mapped to our Recipe shape (source attribution "TheMealDB" + sourceUrl to themealdb.com).
- UI: "🔎 Search recipes" button in RecipesTab actions bar → modal with search input, results grid (thumb + name), tap → preview (reuse Task 4 preview) → Save to catalog. Loading/empty/error states.

## Task 6: /analytics + /skill-tree repairs
Files: `src/lib/schedule-analytics.ts` (or wherever queries live), `src/lib/skill-tree.ts`, `src/lib/pb-seed.ts`
- analytics: queries reference `consuela_events`/`consuela_tasks`; real collections are `events`/`tasks`. Fix collection names. Verify /analytics loads data without 500s.
- skill-tree: reads `skill_tree_profiles`/`skill_branches`/`quests` which are unseeded. Add the collections to pb-seed.ts (open PUBLIC_RULES like the rest) with the schema the code expects, and run the seed against live PB. Verify /skill-tree renders (empty state ok, no 500).

## Task 7: Home layout + misc fixes
Files: `src/lib/layout-config.ts`, `src/lib/sync-service.ts`, `src/app/memory/page.tsx`
- tabletSpanFor parity: compute stretch from the VISIBLE widget count (morningBriefing renders null when empty), so no lone half-row on tablet/2-col desktop. Update tests/unit/layout-config.test.ts contract.
- sync-service.ts hardcoded `http://100.120.64.66:6789`: remove the stale pre-PocketBase sync calls (or gate behind env); stop the 7 failing requests per page load. Check SyncInit usage — keep PocketBase CacheRefresher untouched.
- /memory dead-end bare div: give it a proper PageShell + capsule nav + honest empty state (or redirect to Home if truly obsolete — decide by reading the file; prefer PageShell + empty state).

## Task 8: Modal a11y upgrade + .tap convention swaps
Files: `src/components/ui/Modal.tsx` + worst offender overlays (~16 identified in static-audit.md)
- Upgrade ui/Modal.tsx once: role="dialog" aria-modal, ESC to close, focus trap (Tab cycles inside), focus restore on close, backdrop click close. Reduced-motion safe.
- Route the overlay offenders listed in static-audit.md through Modal (or add the same handlers where a modal shell isn't appropriate). Add unit tests for ESC/focus behavior.
- Swap the ~32 ad-hoc `active:scale-*`/`hover:scale-*` (list in static-audit.md) to `.tap`/`.tap-sm` across the ~15 files. Kitchen tabs: remove scale animations entirely (calm surface) — keep color/opacity transitions.

## Task 9: Dead code cleanup
Files: ~30 dead files listed in static-audit.md (src/modes/ tree except RewardsShop, src/components/morning-briefing/, src/styles/*.css, dead hooks/libs)
- Verify each candidate has zero import sites (grep) before deleting. Delete in one commit. Fix any stale references (deleted BottomNav / /more already verified clean — re-verify).
- Also remove console.log noise in client render paths (list in static-audit.md) — keep intentional error logging.
- Lint after: expect ~30 of the 77 baseline problems gone; 0 new.

## Task 10: AGENTS.md + final verification
Files: `AGENTS.md`
- Update snapshot + UI Change Record + Change Log for everything landed (careful: file has foreign uncommitted edits — preserve them, append ours).
- Full verification: typecheck, build, vitest, lint (0 new vs baseline), browser pass on all changed surfaces at 390/768/1440.
- Do NOT push. Report ready-for-visual-review.
