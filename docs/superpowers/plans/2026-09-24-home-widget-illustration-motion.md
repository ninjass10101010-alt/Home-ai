# Home Widget Illustration & Motion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Home dashboard a cohesive, playful vector-icon language and more expressive, state-aware motion while preserving Consuela’s warm-glass card design.

**Architecture:** Keep warm glass as the surface and layout system. Give Weather a distinctive storybook poster composition, with sky blue leading on clear days and truthful palettes for other conditions; use a shared inline-SVG icon family and restrained state changes across the remaining Home widget icon slots.

**Tech stack:** Existing Next.js/React components, inline SVG, CSS animations and transitions, Vitest, Playwright. No external art or icon assets.

## Global Constraints

- Keep current warm-glass card surfaces, layout, data, and behavior.
- Use CSS/SVG/emoji only; no downloaded fonts, paid assets, icon libraries, or WebGL.
- Use the existing SF Pro stack; evoke condensed display type through scale, weight, and tight tracking.
- Weather visuals and colors must follow real conditions; maintain readable contrast across scenes.
- Motion must respect `prefers-reduced-motion`. Outside Weather’s existing scene, avoid decorative infinite loops.
- Keep icons decorative and hidden from assistive technology when their meaning is already conveyed by text.
- Scope this to Home widget artwork and motion—not the CapsuleNav glyphs, inline row emojis, or kid-only Home surface.
- Do not change factual copy, data contracts, or interaction semantics.
- Do not add dependencies or new font files.

## File Map

- Create `src/components/ui/HomeWidgetIcon.tsx`: shared inline-SVG icon family for Home widget and stat-tile icon slots.
- Modify `src/components/ui/WeatherWidget.tsx`, `WxToys.tsx`, `WeatherSkins.ts`, `wx-tokens.ts`: weather poster artwork and condition palettes.
- Modify `src/components/patterns/WidgetCard.tsx`, `SectionCard.tsx`, `StatTile.tsx`, `src/app/page.tsx`, and Home widget components: render the shared icon family across Home.
- Modify `src/app/globals.css`: shared icon-state motion and reduced-motion rules.
- Add focused icon-system coverage and extend existing widget tests.
- Update `docs/DESIGN.md` and append a shipped entry to `CHANGELOG.md`.

## Baseline

At branch setup, `npm run typecheck` passed. The full Vitest run passed 2478 tests with two known unhandled DOM-removal errors in `tests/unit/tasks-approve-all.test.tsx`. The full lint run reported 66 pre-existing problems in unrelated files. These are not feature regressions and must not be silently “fixed” in this plan.

---

### Task 1: Define and test the shared Home icon family

**Files:**
- Create: `src/components/ui/HomeWidgetIcon.tsx`
- Create: `tests/unit/home-widget-icon.test.tsx`

**Interfaces:**
- Produces `HomeWidgetIcon({ variant, state?, size?, className?, title? })` with variants for briefing, ask, suggestions, leaderboard, events, schedule, meal, tasks, week, security, climate, lights, and ledger.
- Produces a small exported `HomeWidgetIconVariant` type and a state type for supported stateful variants.
- The component renders an inline SVG with `aria-hidden="true"` for decorative widget use.

- [ ] **Step 1: Write the failing test.** Test every supported variant, decorative semantics, size classes, and one stateful icon state. Assert that the rendered SVG has no accessible text duplication and that the supported variant set is complete.
- [ ] **Step 2: Run the focused test to verify it fails.** Run `npm test -- --run tests/unit/home-widget-icon.test.tsx`; expect failure because the component does not exist.
- [ ] **Step 3: Implement the minimal component.** Use a single viewBox, flat geometric SVG shapes, currentColor/white surfaces, and a small accent shape per variant. Keep static markup deterministic and avoid imports of external icon libraries.
- [ ] **Step 4: Run the focused test to verify it passes.** Run the same command; expect all icon tests to pass.
- [ ] **Step 5: Commit.** Run `git add src/components/ui/HomeWidgetIcon.tsx tests/unit/home-widget-icon.test.tsx && git commit -m "feat(ui): add shared home widget icon family"`.

### Task 2: Refine Weather into the illustrated poster hero

**Files:**
- Modify: `src/components/ui/WeatherWidget.tsx`
- Modify: `src/components/ui/WxToys.tsx`
- Modify: `src/components/ui/WeatherSkins.ts`
- Modify: `src/components/ui/wx-tokens.ts`
- Test: `tests/unit/weather-widget.test.tsx`
- Test: `tests/unit/weather-severity.test.ts`

**Interfaces:**
- Preserve `wmoToScene`, `sceneToCondition`, `dayCondition`, `getWeatherSkin`, `Condition`, and the existing timeline/data contracts.
- Add no new external data source. Clear-day scene values must resolve to the sky-blue signature; rain, snow, night, and severe conditions retain condition-aware values.

- [ ] **Step 1: Write failing weather tests.** Add assertions for the clear-day blue palette, the existing condition-specific palettes, the poster scene layers, and the existing timeline/scrubber contracts after a scene change.
- [ ] **Step 2: Run the focused weather tests to verify they fail.** Run `npm test -- --run tests/unit/weather-widget.test.tsx tests/unit/weather-severity.test.ts`; expect only the new assertions to fail.
- [ ] **Step 3: Implement the scene and palette changes.** Make the clear sky a deliberate sky-blue canvas, add layered turquoise cloud forms and geometric weather accents, and keep the temperature as the dominant readable object. Use crossfades and data-driven motion already owned by the weather scene; do not add an unrelated looping effect.
- [ ] **Step 4: Run the focused weather tests to verify they pass.** Run the same command and inspect the test count and failures.
- [ ] **Step 5: Commit.** Run `git add src/components/ui/WeatherWidget.tsx src/components/ui/WxToys.tsx src/components/ui/WeatherSkins.ts src/components/ui/wx-tokens.ts tests/unit/weather-widget.test.tsx tests/unit/weather-severity.test.ts && git commit -m "feat(weather): refine illustrated poster scene"`.

### Task 3: Wire the icon family across Home widget slots

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/patterns/StatTile.tsx`
- Modify: `src/components/patterns/WidgetCard.tsx`
- Modify: `src/components/patterns/SectionCard.tsx`
- Modify: `src/components/ui/ScheduleDisplay.tsx`
- Modify: `src/components/briefing/MorningBriefingWidget.tsx`
- Modify: `src/components/suggestions/HomeSuggestionsWidget.tsx`
- Modify: `src/components/leaderboard/HomeLeaderboardWidget.tsx`
- Modify: `src/components/meals/CurrentMealWidget.tsx`
- Modify: `src/components/ha/HomeSecurityWidget.tsx`
- Modify: `src/components/ha/HomeClimateWidget.tsx`
- Modify: `src/components/ha/HomeLightsWidget.tsx`
- Modify: `src/components/finance/LedgerWidget.tsx`
- Test: existing focused Home widget suites listed in the approved plan.

**Interfaces:**
- `WidgetCard.icon` and `SectionCard.icon` accept `ReactNode`, so `HomeWidgetIcon` can be passed without changing the public card API.
- `StatTile.icon` accepts `ReactNode`; retain the existing numeric/progress behavior.
- Existing content, actions, tones, and empty/error states remain unchanged.

- [ ] **Step 1: Write failing integration assertions.** Update or add focused tests to assert that Home widget headers/stat tiles expose the new SVG family and no longer render the old emoji in the owned icon slot.
- [ ] **Step 2: Run the focused Home widget tests to verify they fail.** Run the affected suites; expect the new icon assertions to fail before wiring.
- [ ] **Step 3: Wire the shared component.** Replace only owned Home widget/stat-tile icon slots. Keep Weather’s condition illustration, row-level emoji, CapsuleNav icons, and kid-only Home artwork out of scope.
- [ ] **Step 4: Run the focused Home widget tests to verify they pass.** Run all touched widget suites and confirm no content or interaction assertions regress.
- [ ] **Step 5: Commit.** Stage only the icon wiring and its tests, then commit with `git commit -m "feat(home): apply illustrated widget icon family"`.

### Task 4: Add and test state-aware icon motion

**Files:**
- Modify: `src/components/ui/HomeWidgetIcon.tsx`
- Modify: `src/app/globals.css`
- Modify: stateful Home widget components only where a real state seam already exists
- Test: focused icon/motion and existing meal, briefing, lights, security tests

**Interfaces:**
- Motion is CSS-only and receives a semantic state class/data attribute from the existing component state.
- No new animation runs while state is unchanged; no new global polling or state store is introduced.
- `prefers-reduced-motion: reduce` removes the animation and transition while retaining the state class and static icon.

- [ ] **Step 1: Write failing state/motion tests.** Assert that meal proximity, briefing acknowledgement, light on/off, and security attention select the expected state hook, and that the CSS contains matching reduced-motion overrides.
- [ ] **Step 2: Run the focused motion tests to verify they fail.** Run the selected suites; expect missing state hooks/classes to fail.
- [ ] **Step 3: Implement minimal state hooks and CSS motion.** Add short one-shot transitions for real state changes only. Keep the existing card hover/resonance behavior and weather ambient scene separate.
- [ ] **Step 4: Run the focused motion tests to verify they pass.** Run the same suites and inspect the reduced-motion assertions.
- [ ] **Step 5: Commit.** Stage only motion-related files and tests, then commit with `git commit -m "feat(ui): add state-aware widget motion"`.

### Task 5: Verify, document, and ship the visual contract

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `CHANGELOG.md`
- Create or update: focused visual probe only if the existing probes cannot express the new icon contract.

- [ ] **Step 1: Update the design contract.** Replace the current Weather-only visual rule in `docs/DESIGN.md` with the approved hybrid: warm glass remains the frame, Weather is the illustrated poster, and Home widgets share the vector icon language. Record the state-aware motion boundary and reduced-motion requirement.
- [ ] **Step 2: Update the design system documentation.** Document `HomeWidgetIcon`, the supported variants, and the rule for decorative SVG icons in the existing `docs/DESIGN.md` design-system section.
- [ ] **Step 3: Run targeted tests and the required gates.** Run the touched Vitest suites, `npm run typecheck`, `npm run lint`, and `npm run build`; distinguish the recorded baseline failures from new failures.
- [ ] **Step 4: Run one batched visual inspection.** Use the existing weather and protruding-icon Playwright probes plus a phone/wide screenshot pass in light and dark themes. Inspect for clipping, overflow, contrast, missing state content, console errors, and incorrect icon sizing. Fix all findings in one batch, then confirm with at most one second pass.
- [ ] **Step 5: Record shipped changes and review the diff.** Append a dated long-form `CHANGELOG.md` entry with files, visual/motion behavior, tests, probes, and baseline caveats. Run the security diff review before any commit of final docs/changes.
- [ ] **Step 6: Commit the verified feature.** Stage only intended files, inspect `git status`, `git diff`, and `git log --oneline -10`, then commit with `git commit -m "feat(home): polish illustrated widgets and motion"`.
