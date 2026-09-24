# Plan — Consuela (Home-ai)

> How work is planned, tracked, and accepted in this repo. This is the standing pointer; per-feature work follows the dated spec/plan convention. **LLM-to-LLM:** add new standing work items HERE — never to loose root TODO files.

## How work flows

1. **Brainstorm → design spec** — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (outer Dashboard repo)
2. **Implementation plan** — `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` (task-by-task, TDD where applicable)
3. **Execute** — task-by-task with per-task commits; focused suites green + `npm run typecheck` clean per task
4. **Ship** — CHANGELOG.md entry + parent submodule pointer bump + push-safe + push (see AGENTS.md §6)

## Acceptance gates (every shipped change)

- Focused test suites green, `npm run typecheck` clean, `next build` clean when routes change
- CHANGELOG.md long-form entry appended in the same session
- UI-affecting changes: a `### UI Change Record` in `docs/DESIGN.md` with its **CONTRACTS to keep**
- `bash scripts/security/push-safe.sh` → CLEAN before pushing
- Session ends with clean `git status` in BOTH repos; finish with "Deploy to NAS now?"

## Open items (absorbed from root TODO.md 2026-09-24 — stale, verify before doing)

- [ ] Translate OpenRouter action types into existing local behaviors (insert/update DB/localStorage) — old chat action-card TODO
- [ ] Clean up duplicate `useEffect` block that deletes `q` from the URL
- [ ] Run `npm run lint` and `npm run build` to verify (last recorded TODO state)

## Roadmap

Current direction = the newest CHANGELOG entries + the parent repo's `docs/superpowers/specs|plans/`. There is no separate backlog file — deliberately: work items live here until picked up, then become a dated spec/plan pair.
