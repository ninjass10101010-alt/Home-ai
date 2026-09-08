# Design — Dashboard-Owned LLM Brain, Agent Memory, and Obsidian Mirror

**Date:** 2026-09-07
**Status:** Approved design (user-locked decisions recorded inline)
**Repo:** Home-ai (Consuela family dashboard)

## Summary

The dashboard recently grew its own identity: soul boot files (`ai/SOUL.md`, `ai/IDENTITY.md`, `ai/TOOLS.md`, `ai/KID.md`) injected at prebuild, a dashboard-owned fallback chain, and kid/adult persona split. This design finishes the job in three moves:

1. **The dashboard's own LLM provider chain becomes the only brain.** Hermes is fully removed from the chat path, from Settings, and from Clem.
2. **The existing (unwired) PocketBase memory system becomes real agent tools** — adults-only — so Consuela can remember, recall, and forget family facts in chat.
3. **An Obsidian mirror** keeps the user's second brain (on their Mac, in Google Drive) fed with those memories via a Mac-side pull agent.

Plus a new **opencode-style "AI Models" settings card** so the family can see which model is loaded, switch providers, edit keys, and order the fallback chain without SSH.

## Current state (investigated 2026-09-07)

### What exists and works
- **Souls**: `ai/*.md` boot files embedded at prebuild into `src/lib/ai-boot.generated.ts` (`scripts/write-ai-boot.mjs` — missing files or kid-toolset drift fail the build). `buildChatContext` (src/app/api/hermes/chat/route.ts) branches: child → `buildKidSystemPrompt`, adult → `buildConsuelaSystemPrompt` + house addendum, Clem → `buildClemSystemPrompt`.
- **Tool surface**: `src/lib/hermes-tools.ts` — 14 daily-life + 5 admin tools, native OpenAI tool-calling, kid allowlist via `KID_TOOL_NAMES`.
- **Fallback chain**: `src/lib/ai-fallback.ts` resolves Settings → Services & Keys → "AI Fallback Models" (`FALLBACK_API_URL` / `FALLBACK_API_KEY` / `FALLBACK_MODELS`, comma-separated, tried in order). Used lazily by the chat route only after Hermes fails.
- **Memory system (unwired to the agent)**: `src/lib/family-memory.ts` + PB collection `consuela_family_memories` + `/api/family-memory` routes + `FamilyMemoryBrowser` UI. Categories: family, facts, preferences, health, schedule, skills, other. Per-person, usage counting, confidence. **Zero agent tools exist for it.**

### What is broken / inconsistent
- **Hermes is still the primary brain.** `resolveHermes()` (route.ts:57) resolves `HERMES_API_URL` (default `hermes-agent-2:8643`); `HERMES_MODEL = "consuela"` is hardcoded (route.ts:70); Clem is hardcoded to `hermes-agent-2:8643` (route.ts:305-307). The dashboard-owned chain is only a fallback.
- **Settings confusion**: the "Hermes AI" card (registry.ts:72-80) and "AI Fallback Models" card coexist; no UI shows which model is actually loaded; no way to change provider/model without SSH.
- **`buildToolsForOpenAI` takes a `role` param but ignores it** — latent inconsistency.
- **Obsidian: zero references in dashboard code.** Investigation of the NAS Hermes profile (`/share/Container/Hermes/profiles/consuela/`) found only the bundled `obsidian` skill (now merged into `productivity-document-workflows`) — a *capability*, never a *connection*: no vault path in config, no SMB share, no Google Drive sync job, no container mount. **The Hermes↔Obsidian link never actually existed.** We design it fresh.

### The vault (on the user's Mac)
- Obsidian vault: `~/Library/CloudStorage/GoogleDrive-ninjass10101010@gmail.com/My Drive/Obsidian Vault/Brain`
- Has structure: `Memory/`, `Journal/`, `Knowledge/`, `Daily/`, `Projects/`, `System/`, `Templates/`, etc.
- Synced by the Google Drive desktop app. The NAS has **no** direct path to it (verified: no SMB share, no HBS job, no mount). CloudStorage placeholder files make SMB/CI-mirroring fragile — ruled out.

## User-locked decisions

| Decision | Choice |
|---|---|
| Hermes fate | **Fully remove** from code and UI; new provider chain is the only brain |
| Memory | **PB memory + Obsidian mirror** (keep the Obsidian second brain fed) |
| Settings scope | **Full provider manager** (opencode-style: live model list, provider CRUD, key editing, chain ordering) |
| Memory tool access | **Adults-only** (kids never get memory tools) |
| Approach | **A — in-place rearchitecture** (keep the chat route and its callers) |
| Obsidian topology | **Mac pull-agent** (CRON_SECRET-gated export; launchd on the Mac; Google Drive syncs as it already does) |

## Architecture

### 1. Provider registry (PB)

New PB collection **`consuela_ai_providers`** (seeded in `src/lib/pb-seed.ts` with autodate fields + admin-only rules like the rest):

| Field | Type | Notes |
|---|---|---|
| `displayName` | text | e.g. "b.ai free tier" |
| `baseUrl` | text | OpenAI-compatible base; `/v1` paste-tolerant (normalize like ai-fallback.ts does today) |
| `apiKey` | text | AES-256-GCM encrypted via existing `secret-box.ts` |
| `models` | json | Ordered array; **index 0 is the active model** |
| `enabled` | bool | Disabled providers drop out of the chain |
| `order` | number | Chain position among providers |

**Resolution order** (new `src/lib/ai/targets.ts` → `resolveChatTargets()`):
1. PB `consuela_ai_providers` (enabled, by order): provider 0's first model is the brain; its remaining models, then provider 1's models, etc. form the fallback chain.
2. **Bootstrap = today's behavior**: if no provider rows exist, fall back to the existing `FALLBACK_*` keys (PB service-config → env → null). Zero-migration cutover; current config keeps working.
3. Env bootstrap for fresh installs: `AI_PROVIDER_URL` / `AI_PROVIDER_KEY` / `AI_PROVIDER_MODELS` (documented in `.env.example`).

10-minute TTL cache + `resetAiTargetsForTests()` seam — mirrors the existing Hermes config cache pattern.

### 2. Chat route rewiring (`/api/hermes/chat`)

All 10 callers (`useMeals`, `useRecipes`, tasks page ×2, chat page, Clem, recipes ingest, etc.) stay untouched — same URL, same SSE protocol, same buffered mode.

Changes inside the route:
- Delete `resolveHermes()`, `HERMES_MODEL`, the Clem hardcode; everything resolves via `resolveChatTargets()`.
- `ChatTarget[]` now comes straight from the resolver: `[brain, ...fallbacks]`. Both the streamed and buffered loops keep their existing lazy-fallback expansion.
- Clem (`agent === "clem"`) uses the same chain — no special-casing.
- The `[hermes]` log line becomes `[ai] provider={displayName} model={model} role={role}` (and feeds the settings display).

**Deleted**: `src/lib/ai-fallback.ts` (+ its tests) — superseded by `src/lib/ai/targets.ts`.

### 3. AI Models settings card (adults-only)

New `AiModelsCard.tsx` in Settings → Integrations, replacing the **"Hermes AI"** and **"AI Fallback Models"** rows in the Services & Keys registry (`src/lib/services/registry.ts`):

- **Header**: 🧠 chip "Currently loaded: `{model}` · via `{displayName}`" + a status dot (server pings the active provider's `/v1/models` or a cheap completions probe).
- **Provider list**: add / edit / remove providers (name, base URL, masked key field, enabled toggle, order).
- **Model picker (opencode-style)**: per provider, a "Load models" button calls the provider's `/v1/models` **through a new server route** — the API key never reaches the browser. Checkbox the models to include; ↑/↓ orders the chain; model 0 wears an "In use" badge. Manual model entry allowed for endpoints that don't implement listing.
- New adults-gated routes:
  - `GET/PUT/DELETE /api/ai/providers` (GET masks keys to a 2-char suffix like Services & Keys does)
  - `GET /api/ai/models?providerId=…` (server-side proxy to the provider's `/v1/models`; used by the picker and the status dot)
- Registry cleanup: `hermes` + `ai_fallback` ServiceDefs removed; `HERMES_API_URL`/`HERMES_API_KEY` and `FALLBACK_*` keys stop being accepted by `/api/services/*` (kept read-compat for the bootstrap only via `getServiceConfig` direct calls, not the registry).

### 4. Memory agent tools (adults-only)

Three new tools in `src/lib/hermes-tools.ts` (registry entries + handlers), wired to `family-memory.ts`:

| Tool | Behavior |
|---|---|
| `remember_fact` | Store `{content, category?, person?}` — defaults category `other`; tool description instructs confirm-then-store |
| `recall_memories` | Search by keyword / person / category; top 10 by recency-then-usage; increments `useCount`/`lastUsedAt` via existing plumbing |
| `forget_memory` | Recall-then-delete by id; tool description instructs confirm before forgetting |

**Gating**: `buildToolsForOpenAI({ houseControl: role !== "child", role })` — memory tools ride the same `role !== "child"` gate as house control. The `role` param finally does something: memory + house control are the only role-keyed tools.

**Soul files in lockstep** (prebuild enforces the kid drift check):
- `ai/TOOLS.md` gains the three memory tool rows.
- `ai/SOUL.md` gains a short memory section: check `recall_memories` before answering questions about the family; confirm before `remember_fact`/`forget_memory`.
- `ai/KID.md` — no changes needed (kid allowlist never includes them; verified by the existing drift test).

### 5. Obsidian mirror (Mac pull-agent)

**Dashboard side (export API)**:
- `POST /api/cron/consuela/memory-export` — returns `{ exportedAt, memories: [...] }` for all memories, `Authorization: Bearer $CRON_SECRET` (same pattern as the other 6 cron routes; fail-closed via `isCronAuthorized`).

**Mac side (pull agent)**:
- `scripts/obsidian-agent/consuela-memory-agent.mjs` (Node ≥18, zero deps — fetch + fs): every run pulls the export and renders one markdown note per memory into the vault at:

  `Obsidian Vault/Brain/Memory/Consuela/{category}/{person-or-General}/{slug}.md`

  - YAML frontmatter: `title, category, person, created, updated, usage, id`
  - Body: memory content + "Imported by Consuela — edit in the dashboard, not here" footer
  - Idempotent: same id → same filename → overwrite; no deletions (v1 is one-way)
  - `_index.md` regenerated per run per folder
  - A `README.md` in `Memory/Consuela/` explains the one-way contract (written once by the agent)
- `com.garcia.consuela-memory-agent.plist` — launchd `StartInterval 900` (15 min), `StandardOutErr` log, `RunAtLoad`. Install instructions in the script header + AGENTS.md SOP.
- Endpoint/base URL and key read from a small local config (`~/.config/consuela/memory-agent.json`) — instructions in the runbook, never committed with real values.

**Why this topology** (investigated and user-locked): the vault lives in macOS CloudStorage (Google Drive); the NAS has no path to it and placeholder-file semantics make SMB/container mounts corrupting hazards. The Mac agent is offline-tolerant (catches up on next run) and needs zero NAS-side changes.

## What does NOT change

- SSE streaming protocol, tool loop, `MAX_ROUNDS`, persist behavior, `threadId` conventions.
- Kid sessions: kid soul, read-only allowlist, no memory tools, no house control.
- The 10 chat callers' URLs and payloads.
- Souls' voices (SOUL/KID content beyond the new memory section).
- All other Services & Keys cards.

## Error handling

- **Provider down / chain exhausted**: existing behavior — honest chat error ("I hit a snag connecting to my brain…"). Status dot in settings turns red with the last error string.
- **No provider configured** (fresh install, no env): chat route returns the same honest error; settings card shows an empty-state with "Add a provider" CTA.
- **Memory store down** (PB unreachable): `recall_memories` returns "memory is unavailable right now" so the model can say so honestly; `remember_fact` fails with a tool error (never silently pretends to remember).
- **Mirror agent offline**: nothing breaks — export endpoint is pull-based; vault just goes stale until the next run.
- **`/v1/models` unsupported by provider**: settings picker shows "Couldn't list models — enter names manually" with the manual-entry field.

## Testing

**Unit (vitest, TDD)**
- `ai/targets`: provider ordering, model-0-is-brain, `/v1` normalization, disabled-provider exclusion, PB-empty → `FALLBACK_*` bootstrap, env bootstrap, TTL cache, test seam.
- `hermes-tools` memory gating: child session → tools absent; parent → present; handlers round-trip through a mocked `family-memory.ts` (remember/recall increments usage/forget).
- Obsidian export route: 401 without bearer, 200 with bearer, payload shape.
- Chat route tests: re-pointed from Hermes mocks at the new resolver; streamed + buffered lazy-fallback expansion still exercised.
- `pb-seed`: `consuela_ai_providers` collection present with autodate + admin rules (extends the existing field-heal test file).

**Verification gates (same bar as every recent feature)**
- `tsc --noEmit` clean; eslint clean on touched files; full suite green (baseline 1225/1225); production build clean.
- **Live NAS probe**: deploy → chat answers on the new provider (log line shows provider+model), settings card lists/edits providers + loads models, kid session has no memory tools (grep the tools payload server-side), adult `remember_fact` → PB row → `recall_memories` returns it.
- **Mac agent probe**: run agent once manually → notes appear in `Brain/Memory/Consuela/` with correct frontmatter; second run is idempotent; launchd install verified with `launchctl list`.

## Ops runbook deltas

- `.env.example`: + `AI_PROVIDER_URL`, `AI_PROVIDER_KEY`, `AI_PROVIDER_MODELS`. (The vault path lives only in the Mac agent's local config — never on the NAS.)
- `docker-compose.yml`: no Hermes vars required anymore; `CRON_SECRET` reused by the export route (already present).
- AGENTS.md: snapshot entry, §5 tool count 19→22, SOP for the Mac agent install, journey "How do I change Consuela's brain?".
- `DEPLOY_NAS_LOCAL.md` (gitignored): Mac-agent install steps with real paths.
- Hermes registry entries deleted → after deploy, `/api/services/*` rejects `hermes`/`ai_fallback` pairs (no data migration needed; stale PB service-config rows are simply unused).

## Out of scope (v1)

- Two-way Obsidian sync / conflict resolution (PB always wins; one-way export only).
- Per-message model override (e.g. "answer with the cheap model").
- Streaming from non-first providers (fallback targets already stream buffered today — unchanged).
- Migrating Clem's grocery knowledge anywhere — Clem rides the same chain.
- Deleting the `hermes-tools.ts` *file name* and `/api/hermes/chat` *URL* (cosmetic; the route keeps its URL so 10 callers don't churn — a rename can be a later cosmetic pass).
