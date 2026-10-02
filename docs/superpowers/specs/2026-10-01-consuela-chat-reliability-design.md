# Consuela Chat Reliability + Thinking UI + Tool Gaps — Design

**Date:** 2026-10-01
**Status:** Approved by user (symptom answers + thinking-UI picks + tool-gap picks recorded below)
**Scope:** `Home-ai` — the Ask Consuela chat pipeline (client store, SSE stream client, `/api/hermes/chat` streamed route) and the LLM tool registry.
**Companion plan:** `docs/superpowers/plans/2026-10-01-consuela-chat-reliability.md`

## 1. Problem (verified evaluation)

Two reported symptoms on the live NAS dashboard:

1. **"If the LLM replies it never shows up when it finishes — only if I refresh the page."**
   User-confirmed end state: *the typing dots bounce for a bit, then stop, and no response bubble appears.* The reply IS in PocketBase (refresh shows it), so the server answered and persisted — the live client just never rendered it.
2. **"If I had a tool call error, I do not get a response back."** The round that follows a tool error (where the reasoning model re-plans at length) ends with nothing useful on screen.

The user **likes** the thinking display and wants it made better; they also want the LLM's tool coverage audited and filled so it can operate the dashboard.

**Live environment:** the brain chain resolves through `resolveChatTargets()` → the Hermes gateway (`hermes-agent-2:8642` → OpenCode Go relay → `deepseek-v4-flash`, a **reasoning model** that streams `reasoning_content` before `content`). Whether fallback providers exist behind it is currently unknown (user: "Not sure") — post-deploy, Settings → AI Models → AI Health answers this, and every fix below is brain-agnostic.

## 2. Root cause (code-verified)

**Headline — optimistic-id collision (deterministic, matches the symptom exactly):**
`chat-store.ts` resets `msgCounter = 100` on every page load, but `persistHistory()` keeps previous sessions' messages (ids ~101, 102, …) in localStorage, and `ensureHydrated()` merges them back in. A fresh session's optimistic reply row (`streamId` — an even number in the same range) **collides with a stale assistant row**: `onToken`'s `prev.some(m => m.id === streamId)` finds the stale row and *overwrites it* instead of appending a new bubble. The stale row carries yesterday's timestamp, so the reply sorts far above the newest messages (or hides behind a reset marker) — the dots stop and nothing appears. Refresh re-hydrates from PB (synthetic 2M ids, no collision) and the reply is there. The tool-error variant is the same mechanism: a tool-error round produces no round-1 tokens, and the round-2 answer vanishes into the collided row. Bonus: optimistic user rows also produce duplicate React keys.

The 2026-09-04 review fixed exactly this class for PB rows (2M monotonic counter) but left localStorage rows and the per-load counter reset untouched.

**Contributing weaknesses (each verified in code, each fixed):**

| # | Weakness | Where |
|---|----------|-------|
| W1 | The SSE read loop races only the stop signal, never the 5-min watchdog — a wedged body read leaves the dots bouncing forever | `chat-stream.ts:122-141` |
| W2 | 60s per-call timeout is too tight for reasoning models re-planning after tool errors | `route.ts:49` (`AI_TIMEOUT_MS`) |
| W3 | The route's honest `event: error` text is discarded by `send()`'s catch for generic offline copy — tool errors read as "no response" | `chat-store.ts:404-421` |
| W4 | No SSE heartbeat during long silent reasoning; no `X-Accel-Buffering: no` — buffering intermediaries can drop the final burst | `route.ts` streamed handler |
| W5 | `tool_call_id: tc.id \|\| ""` — gateways that omit ids in stream deltas make the NEXT round 400 | `route.ts:503` |
| W6 | Client concatenates ALL rounds' tokens (C1+C2) into one bubble while only C2 is persisted → post-reply reconcile appends a mismatched duplicate; refresh shows a different thread | route + client |
| W7 | Zero token frames + `[DONE]` renders the empty husk "I processed that." while PB holds the real reply | `chat-store.ts:344` |

## 3. Goals / Non-goals

**Goals**
- Replies always render live: fix the id collision + every weakness above.
- Thinking display, upgraded (user picked ALL of): live reasoning transcript (collapsible, Claude/DeepSeek-style), richer truth-per-phase status labels, and per-tool activity chips with success/error states so failures are visible.
- Fill the approved tool gaps following the existing role/PIN safety model.

**Non-goals**
- No change to auth/session/role gating semantics; no change to points/PIN authority rules (chat never moves points).
- No transport rebuild (WebSocket) — the SSE passthrough shape stays.
- Reasoning text is **display-only**: never persisted to PocketBase or localStorage.
- Money Mountain tools were offered and **not selected** this round.
- No Hermes container changes (dashboard-owned chain only).

## 4. Architecture

### 4.1 Landing 1 — Replies reliably render

1. **Collision-proof optimistic ids** — reseed `msgCounter` to `max(merged ids under 2M)+1` after hydration. Optimistic ids stay below the PB synthetic range (2M+), disjoint by construction.
2. **Watchdog races the read loop** — the composed `failSignal` (stop ∨ watchdog) drives both the fetch and the read-loop race; a wedged stream resolves honestly instead of hanging. Test seam: `watchdogMs` option.
3. **Route error passthrough** — new `RouteChatError` carries the route's `event: error` text; `send()`'s catch renders it verbatim (identified by `error.name === "RouteChatError"` — survives module mocks and serialization). Network failures keep the offline/server copy.
4. **SSE heartbeat** — `: ping\n\n` comment frame every 15s (client parser already drops comment-only frames); `X-Accel-Buffering: no` response header.
5. **Tool-call id backfill** — synthesize `call_<ts>_<i>_<rand>` before ids are pushed; round 2 never posts an empty `tool_call_id`.
6. **Streamed-call timeout 60s → 120s** (`AI_STREAM_TIMEOUT_MS`); buffered/planner paths stay at 60s.
7. **Round frames** — `event: round {"n","of"}` before every round after the first; the client resets the streamed bubble (`onRoundStart`) so **displayed == persisted** (last round only). Kills the duplicate-after-reconcile mismatch.
8. **Tool-error visibility** — the honest status/frame path (below) shows *which* tool failed.

### 4.2 Landing 2 — Thinking UI (all three options)

- **Route**: forward each `reasoning_content` delta as `event: reasoning {"r"}` (the one-shot "Thinking deeply…" status label stays for the dots phase); buffered upstream replies forward `message.reasoning_content` as one frame. Emit `event: tool {"name","state":"running"|"ok"|"error"}` around every tool execution — the post-result frame parses the tool result for an `error` field. Round frames carry `n`/`of` for truth-per-phase labels.
- **Client**: `chat-stream` gains `onReasoning(full, delta)` + `onToolEvent(ev)`; the store keeps live `thinking` + `toolEvents` state, attaches both to the finished message **in-memory only**, and `persistHistory()` strips them.
- **Page**: new `ThinkingDisclosure` (open while thinking, auto-collapses when the answer starts, re-openable; 💭 header, 12px text floor, 44px target, reduced-motion safe) and `ToolActivityChips` (⏳/✅/❌ per tool) — rendered live under the typing indicator and kept on the finished message.
- **Privacy**: reasoning is transient display state; it never reaches PB or localStorage. Tool activity likewise display-only.

### 4.3 Landing 3 — Tool gaps (user-selected)

All follow the registry's conventions (`TOOLS` array, `withAdmin` writes, `live*` null-degrading reads, `summarize` returns, role gating in-handler + allowlist):

| Tool | Surface | Notes |
|------|---------|-------|
| `remove_grocery_item` | parent | Hard delete by exact name (mirrors `remove_pantry_item`); honest not-found |
| `remove_meal` | parent | Deletes the planned `meal_plan_entries` row (the Meals UI's real delete seam); shared `resolveMealDay` with `add_meal` |
| `get_hall_of_fame` | **kid-safe read** | `hall_of_fame` rows, newest week first, `textEmoji`-sanitized emojis |
| `propose_reward_redemption` | parent proposal | Inert `{tool:"redeem_reward"}` proposal → the new PIN chip; the route's proposal registry generalizes from the single point tool to a `PROPOSAL_TOOLS` map |
| `RedeemRewardChip` | chat page | Mirrors `AdjustPointsChip`; POSTs the canonical `/api/rewards/redeem` with PINs in the JSON body (that route's contract); member PIN confirms, parent name+PIN fields appear for cost > 100; 409/duplicate = done |
| `get_skill_tree` | **kid-safe read** | Kids always get their OWN tree (enforced in-handler via `context.caller.role`); parents may ask for any member |
| `get_time_capsules` | **kid-safe read** | Through `getUserCapsules`' visibility-filtered service |
| `create_time_capsule` | parent | Validates future unlock date; capsule starts empty (contents added on the page) |

Kid surface additions (`get_hall_of_fame`, `get_skill_tree`, `get_time_capsules`) go into BOTH `KID_TOOL_NAMES` and `ai/KID.md` — the `write-ai-boot.mjs` drift gate enforces consistency; `ai/TOOLS.md` gains rows for all new tools; `npm run ai:boot` regenerates the embedded manifest.

## 5. SSE protocol contract (after)

```
data: {"t":"<delta>"}                      — content token (final round only)
event: reasoning\ndata: {"r":"<delta>"}     — reasoning delta (display-only)
event: tool\ndata: {"name","state"}         — tool activity: running | ok | error
event: round\ndata: {"n":<round>,"of":6}    — new model round (client resets the bubble)
event: status\ndata: {"label","proposal"?}  — status line; proposal frames carry the PIN chip payload
event: error\ndata: {"message"}            — terminal failure (client renders verbatim)
: ping                                     — heartbeat every 15s (comment, ignored by parsers)
data: [DONE]                                — terminator
```
Response headers add `X-Accel-Buffering: no`. Streamed upstream calls use `AI_STREAM_TIMEOUT_MS = 120_000`; buffered/planner calls stay `AI_TIMEOUT_MS = 60_000`. Multi-round content is no longer concatenated client-side: the displayed reply is the final round's content, which is exactly what `persistChatPair` writes.

## 6. Error handling

- Route `event: error` text renders verbatim via `RouteChatError`; network/offline keeps the honest offline copy; user stops keep the partial ("Stopped.").
- Watchdog fires → honest "live connection timed out" message with Try again — never infinite dots.
- Tool failures feed the model as JSON `{error}` (unchanged) AND now surface to the user as ❌ chips + status labels — no silent failures.
- Write tools return honest `{ok:false,error}` payloads; removals refuse when nothing matches.
- `create_time_capsule` fails closed for non-parents and past unlock dates.

## 7. Testing

- TDD per task, red→green, committed per task. Suites touched: `chat-store`, `chat-stream`, `hermes-chat-stream`, `chat-page-stream`, new `chat-thinking-ui`, new `chat-redeem-chip` (mirrors `chat-points-chip`), new `hermes-tool-writes`, new `hermes-tool-family`, plus `hermes-tools-live-reads` and `ha-chat-tools` gating.
- NEW Playwright probe `scripts/consuela/verify-chat-reliability.mjs` runs the REAL `/chat` page against route-mocked SSE including the stale-id collision scenario (localStorage seeded with ids 101/102), reasoning frames, tool error/ok chips, and the round reset. `verify-chat-speed.mjs` must stay green.
- Gates: full vitest, `tsc --noEmit`, eslint on touched files, `next build`, both probes.

## 8. Safety/privacy invariants (binding)

- Points and reward redemptions NEVER move from chat — only PIN-confirmed chips; the server re-verifies PINs (`/api/consuela/planner/apply`, `/api/rewards/redeem`).
- Kid tool surface stays reads-only; the three new kid reads are added to `KID_TOOL_NAMES` + `ai/KID.md` (drift-gated).
- Reasoning text + tool activity are display-only — stripped before any persistence.
- `textEmoji` sanitization on any member-emoji surfaced in tool output (photo data-URLs never reach the model or the transcript).
- UI contracts: 12px type floor, ≥44px targets, tokens only, reduced-motion respected.

## 9. Docs / ops

- CHANGELOG long-form entry (same session as ship); DESIGN.md UI Change Record (thinking transcript, tool chips, redemption chip + contracts); ARCHITECTURE.md chat/SSE contract section rewritten to §5 of this spec; AGENTS.md Current Dashboard Snapshot entry (contract change); memory-bank architecture note.
- Per-feature sync dance: gates green → commit → `push-safe.sh` → push `warm-glass-v2` → parent pointer bump in ONE commit → push parent → ask "Deploy to NAS now?" → post-deploy: send a real tool-asking chat message, read Settings → AI Models → AI Health (answers the live-chain question + outcome distribution).
- No PB schema changes → no `npm run pb:seed` needed. No new env/secret requirements.

## 10. Rejected alternatives

- **B — Rebuild the transport (WebSocket)**: huge blast radius; the Next 16 route streaming works, tests exist, and every failure found is fixable inside the current shape.
- **C — Ids+watchdog hotfix only**: faster, but leaves the "make the thinking display better" request and the tool gaps unanswered.
- **Forwarding multi-round content verbatim (no reset)**: keeps a "Let me check…" preamble visible, but displayed ≠ persisted and the reconcile duplicate stays — truth wins.

## 11. User answers recorded (2026-10-01 session)

- Symptom end state: **"It shows the bouncing and thinking for a bit then stops and no response."** → confirms the id-collision/no-bubble path.
- Live chain: **"Not sure"** → post-deploy AI Health check added to the ship task.
- Thinking UI: **all three** — live thinking text + richer status labels + tool activity chips.
- Tool gaps selected: **gap fills for existing surfaces** (remove_grocery_item, remove_meal, Hall of Fame, PIN redemption), **Skill Tree tools**, **Time Capsule tools**. Money Mountain not selected.
- Execution approach: **subagent-driven**.
