# Spec: Age-based PIN-free task flow (under-10 kids)

**Date:** 2026-09-09
**Status:** Approved design — awaiting implementation plan
**Scope:** Tasks page + KidHome + sign-in (Home avatar tap, member picker) + members schema
**Out of scope:** Emergency/chat/HA PINs, server-authoritative approve route (Phase 1 of the backend plan), birthday tracking

---

## 1. Problem

A 5-year-old and an 8-year-old cannot reliably log their own chores: signing in requires a 4-digit PIN, and completing an assigned chore (currently PIN-free) is fine, but the *sign-in* friction is the blocker. Meanwhile the PIN's real job on this dashboard is proving identity — the parent-approval gate is what proves the chore was actually done.

## 2. Rule (single source of truth)

A member with `role === "child"` **and** `age < 10` (today: Aurora 7, Caspian 5):

| Action | Behavior |
|---|---|
| Sign in | One tap on their avatar — no PIN (server-verified eligibility, fail closed) |
| Complete a task **assigned to them** | One tap → `pendingApproval` (⏳ "On the way") — no PIN |
| Claim a universal / "Up for grabs" task | Existing claim modal + their PIN; **points now wait for parent approval** (modal flow unchanged, points timing new) |
| Redeem a reward | Their PIN (unchanged; >100pts already needs parent PIN) |
| Take back their own pending tap | PIN-free (unchanged) |

Everyone else — adults, pets, children age ≥ 10 (Emily 14, Bailey 12, Jasmine 10) — keeps today's exact behavior, **with one change**: every child completion (assigned or claimed) now lands as `pendingApproval` instead of instant points. **PIN proves identity; the parent proves the chore.** Parents completing tasks still award points immediately.

Aging past 10 automatically re-enables the PIN requirement — no code change; the server rule simply stops matching.

## 3. Architecture

### 3.1 Age data becomes real

- `members` PB collection gains an `age` **number** field:
  - `src/lib/pb-seed.ts` — add to the members schema (self-heal patches live PB on next `npm run pb:seed`; add a `pb_migrations/` file for fresh instances).
- One-time data fix populates `age` on the live roster (values already exist in `src/lib/member-fallback.ts`: Rebecca 38, Jeffery 40, Emily 14, Bailey 12, Jasmine 10, Aurora 7, Caspian 5, Rocco 3, Rico 5). Script under `scripts/consuela/`, idempotent.
- Settings → Family Members modal gains an **Age** number input, persisted via the existing `/api/members/admin` write path. Validation: integer 1–120, optional for pets.
- `Member`/`AuthUser` client types carry `age?: number` through the existing member cache/roster flows (`src/lib/member-fallback.ts`, `src/db/index.ts` mapping, `useAuth` hydration). Missing `age` on legacy rows is handled at the *server* rule level (see 3.2) — the client never decides eligibility.

### 3.2 PIN-less sign-in (server-enforced)

- New route `POST /api/auth/quick-login` — body `{ memberName }`:
  1. Load the member from PB (admin client).
  2. Verify `role === "child"` **and** `typeof age === "number"` **and** `age < 10`.
  3. Pass → issue the **same** httpOnly `consuela_session` cookie as `/api/auth/login` (same session library, same TTL). Fail → `403 { error: "pin_required" }` (unknown member → 404; pet or missing age → 403).
  - **Fail closed:** any ambiguity (missing age, wrong role, PB unreachable) requires the normal PIN path. The client never decides eligibility.
- Sign-in surfaces:
  - Home header/family-strip avatar tap → under-10 member: immediate `quick-login` ("Signing in as Aurora…" beat, then the existing success path); everyone else: existing `PinModal` flow.
  - `MemberPickerModal` → same branch (eligibility comes from the member object's `role`/`age` as rendered, but the *server* re-verifies; a stale client roster can only fail safe).
- No PIN is stored, sent, or echoed for under-10 members anywhere in this flow.

### 3.3 Task-flow predicates (task-utils.ts)

Split the current single seam `shouldUsePendingTap(role, task)` into two pure predicates:

```ts
// Every CHILD completion is pending-approval. Covers the assigned-tap path
// (any age kid); the universal-claim path wires this at the page level after
// PIN verification (see 3.4). Parents bypass (instant earn).
completesWithPendingApproval(role: string | undefined, task: Task): boolean
// role === "child" && !task.completed

// Under-10 kids complete ASSIGNED tasks PIN-free (never universal/snatchable).
completesWithoutPin(role: string | undefined, age: number | undefined, task: Task): boolean
// role === "child" && age < 10 && !task.completed && !task.universal && !isSnatchable(task)
```

- `shouldUsePendingTap` is deleted (zero external consumers beyond tasks page + KidHome — both migrate).
- Boundary semantics: `age < 10` means 9 and under are PIN-free; **10 is NOT** (Jasmine, age 10, keeps her PIN). `age === undefined` → never PIN-free (fail closed).

### 3.4 Tasks page changes (src/app/tasks/page.tsx)

- `openPinEntry(taskId)` — the completion entry point:
  1. Pending-take-back branch: unchanged (PIN-free, own row only).
  2. **New** `completesWithoutPin(role, age, task)` branch → `tapCompletePending(...)` + confetti + "Done! +Npts on the way — a parent approves." (reuses the existing pending-tap code path; no PIN modal).
  3. Else if `completesWithPendingApproval(role, task)` (10+ kid, assigned) → open PIN modal prefilled for the signed-in member; on PIN success create `pendingApproval` (NOT an instant earn).
  4. Else (adult) → existing PIN-complete → instant earn.
- **Universal claim modal:** layout unchanged (who + PIN). On a **child** claimant's verified success, the success branch creates `pendingApproval { byName, at, points }` and marks the task done-but-unpaid instead of appending the earn transaction. Adults' claims keep instant points. The claim modal's "who" select defaults to the signed-in member (already does via `pickDefaultClaimMember`).
- **Rewards, penalties, point adjustments, undo of a completed task:** untouched.
- Parents see everything in the existing "Needs approval" section — no new UI beyond what shipped 2026-09-06 (it already renders `byName`, date, points, Approve/Send-back).

### 3.5 KidHome alignment (src/modes/kid/KidHome.tsx)

- Quest "Do it" uses the same two predicates: under-10 assigned quest → PIN-free pending; 10+ → PIN → pending; universal → existing PIN claim flow → pending on success.

### 3.6 Points/ledger invariants (unchanged, restated)

- Pending points never enter `weekData.points`/`history` until approve (existing contract).
- `isPendingApproval()` remains the ONLY pending gate.
- `completedInWeek` keeps the no-double-complete guarantee; regen treats pending as done.
- Approve idempotency caveat (client-side, ~60s two-device window) is documented in AGENTS.md and unchanged by this spec — it is Phase-1 work in the backend plan.

## 4. Data flow (happy path)

```
Aurora taps her avatar → POST /api/auth/quick-login {Aurora}
  → server: role=child, age=7 → session cookie → signed in
Aurora taps "Feed the dog" (assigned to her)
  → completesWithoutPin(child, 7, task) → tapCompletePending()
  → task.pendingApproval = { byName: "Aurora Garcia", at, points }
  → confetti + "Done! +5pts on the way"
Parent opens Tasks → "Needs approval" → Approve (parent PIN)
  → earn tx → points move
```

Claim path (Emily, 14, grabs a universal chore):

```
Emily taps universal task → claim modal → PIN (hers)
  → verified → task marked done + pendingApproval (NOT instant earn)
  → parent approves → points move
```

## 5. Error handling

| Case | Behavior |
|---|---|
| `quick-login` on a 10+ kid / pet / adult | 403 `pin_required` → client falls back to the normal PIN modal (stale-roster safe) |
| `quick-login` on unknown member | 404 → PIN modal |
| PB unreachable at quick-login | 503 → client shows the existing "Couldn't reach Consuela" pattern, offers PIN modal retry |
| Member's `age` missing on live PB (seed not run) | Server treats as ineligible → 403 → PIN modal; **ops note:** run `npm run pb:seed` + data-fix after deploy |
| Kid's session roster stale (age changed on another device) | Server re-verifies per request; a 403 just routes to PIN |
| Claim modal PIN verified but write fails offline | Existing optimistic + snapshot-rollback path unchanged |

## 6. Testing

- **task-utils unit:** `completesWithoutPin` (child+7 assigned → true; child+10 → false; child+undefined age → false; parent+7 → false; universal/snatchable → false; completed → false), `completesWithPendingApproval` (child assigned → true; parent → false; completed → false — the claim path's use of it is page-level wiring covered in page tests).
- **quick-login route tests:** happy path sets cookie; 10+ kid 403; pet 403; missing age 403; unknown 404; PB down 503; cookie parity with `/api/auth/login` (same name/TTL/secure semantics).
- **Page tests (jsdom):** under-10 tap → pending row + toast, no PIN modal; 10+ PIN-complete → pending (assert NO earn tx until approve); child claim success → pending; adult claim success → instant earn (regression guard).
- **KidHome:** quest tap branches per predicate.
- **Live (post-deploy):** sign in as Caspian by tap → complete assigned chore → parent sees it in "Needs approval"; Jasmine (10) still gets the PIN modal.

## 7. Ops / rollout

1. Deploy → run `npm run pb:seed` (adds `members.age`, self-heal).
2. Run the age data-fix script once (fills live roster ages).
3. Settings → Family Members: age input visible; parents can correct.
4. AGENTS.md snapshot + UI Change Record updated in the same session as implementation.

## 8. Rejected alternatives (for the record)

- **Birthday/date-of-birth field:** more precise, but a parent-edited age number is simpler and ages-in automatically; YAGNI.
- **PIN-free claims for under-10s:** user explicitly wants the PIN retained on free-for-all grabs (it's the only identity check on shared tasks).
- **Instant points for under-10s:** violates the "all tasks need parent approval" requirement.
- **Client-side eligibility checks without a server route:** a tampered client could bypass; the rule lives server-side and fails closed.
