# User Profile, Tasks, and Leaderboard — Implementation Spec

**Date:** 2026-08-04
**Status:** Implemented (this document records the agreed design)
**Owner:** Consuela family dashboard (Garcia family)

## Goal

Make the dashboard's user feature feel like a real social-media account system:

1. A member can change their own profile picture (emoji *or* uploaded photo) from a dedicated profile sheet opened by tapping their avatar on Home.
2. Logged-in members see their own tasks by default; everyone sees the full competitive leaderboard (already largely true — verified and tightened).
3. Members can create individual tasks (assigned to themselves) and "anyone can grab" tasks that other family members can claim for points (existing `universal` flow — hardened against races, made discoverable with an "Up for grabs" filter).
4. Backend hardening: profile and PIN changes are PIN-verified server-side via new `/api/members/*` routes (previously all member CRUD ran client-side).

## Confirmed decisions

| Question | Decision |
| --- | --- |
| Avatar model | Emoji **or** uploaded photo, member picks either, dashboard remembers which is active |
| Backend hardening | Full server-side PIN auth + `/api/members/*` routes |
| Photo storage | Inline base64 data URL in the existing `members.emoji` field on PocketBase |
| Bug hunt | Focused pass on user / task / leaderboard / universal-claim flows |
| Profile entrypoint | Dedicated profile sheet from the Home avatar (covers Change avatar, Change PIN, Sign out, link to full Settings) |
| Photo size | 256px longest edge, webp 0.85 (keeps PB row small) |
| Parents | Parents are trusted admins — Settings → Family Members edits stay client-side |
| PR granularity | Coarser — one feature commit |

## Architecture

### Data layer (no schema additions)

The `members` PB collection already stores everything: `emoji` (unicode emoji OR `data:image/...` URL — dual-use already rendered by `Avatar.tsx`), `pin` (plaintext, as before), `color`, `avatarSize`, `glow`, `role`, `name`.

### Server side

- **`src/lib/server-auth.ts`** — `verifyPinFromPB(name, pin)` + `findMemberByName(name)` + `sanitizeMember(member)` using the admin SDK (`withAdmin` from `src/lib/pb-auth.ts`). Name matching mirrors the client's `memberMatchesName` (full name, first name, "(Mom)" suffixes).
- **`POST /api/members/profile`** — body `{ actorName, actorPin, patch }`. Verifies the actor's PIN, allows only `emoji` (≤400KB), `avatarSize` (xs/sm/md/base/lg), `glow`, `color`. Writes only the actor's own row. Returns sanitized member.
- **`POST /api/members/pin`** — body `{ actorName, actorPin, newPin }`. Verifies old PIN, requires `^\d{4}$`, updates the actor's PIN.
- **`GET /api/members/whoami?name=X`** — sanitized member lookup (fresh server truth for the sheet).
- **`POST /api/tasks/claim`** — body `{ taskId, claimantName, claimantPin, title, points, assigneeEmoji }`. Verifies claimant PIN, loads the current `week_data` row, checks `history` for an existing `earn` transaction with `taskId` — if present returns **409 `{ reason: "already-claimed", claimedBy }`**; otherwise appends the transaction, adds the points, and reassigns the PB `tasks` row to the claimant. This is the server-authoritative fix for the two-device double-claim race (the old client guard read `completedInWeek` from local state, so both devices could pass within the 5s structured-sync window and the loser silently overwrote the winner's points).

### Client side

- **`src/components/profile/AvatarPicker.tsx`** — category emoji grid (Faces / People / Pets & animals / Nature / Food / Fun & things), photo upload (`createImageBitmap` + canvas resize to 256px webp, PNG/JPG/WebP/GIF, ≤5MB), "Use emoji" fallback, live preview via `Avatar`.
- **`src/components/profile/ProfileSheet.tsx`** — bottom-sheet modal (the shared `Modal` renders bottom-sheet on mobile): avatar preview + role, Change your avatar card (AvatarPicker + Save avatar), Account card (🔑 Change PIN with current/new/confirm, ⚙️ Full settings link, 🚪 Sign out).
- **`src/app/page.tsx`** — tapping the signed-in member's avatar (header or family strip) opens the sheet; tapping other members keeps the PIN-switch flow.
- **`src/hooks/useAuth.tsx`** — added `changePin(newPin)` (refreshes the in-memory PIN so subsequent PIN-gated actions work); `handleMembersUpdated` now auto-logs-out if the signed-in member was deleted.
- **`src/app/settings/page.tsx`** — the member add/edit modal now uses the shared `AvatarPicker` (replaces the flat emoji grid + paste-image-URL field).
- **`src/app/tasks/page.tsx`** — added "Up for grabs 🤝" filter chip; "My Tasks" now also includes uncompleted universal tasks; the universal claim flow is optimistic with rollback (snapshot restore) + "X already grabbed that one!" toast on a 409 from the claim route. Offline claims keep the optimistic state (local sync reconciles).
- **`src/lib/task-utils.ts`** — `regenerateRecurringTasks` resets universal clones to `assignee: "All"` / `assigneeEmoji: "🤝"` so recurring universal tasks come back unclaimed each week (bug fix: previously they inherited last week's claimant).

## Bugs fixed in the focused pass

1. **Universal task double-claim race** — fixed by the server-authoritative `/api/tasks/claim` route + client rollback.
2. **"My Tasks" hid claimable universal tasks** — filter now includes `t.universal && !t.completed`.
3. **Week-reset regen embedded last week's claimant** — universal clones reset to unclaimed.
4. **Deleted signed-in member left a stale session** — auto-logs out on the next members refresh.
5. **PIN change left the in-memory PIN stale** — `changePin` updates it immediately.
6. **Photo round-trip vs cache refresh** — verified safe: sheet state is local; `db.refreshCaches()` rehydrates everywhere else.

## Non-goals (unchanged)

- PINs stay plaintext in PB (LAN-only NAS; hashing would touch every PIN flow).
- No server-side session/cookie auth; PIN-in-memory model preserved.
- Parents editing other members remains client-side (trusted admins).
- No new PB collections; no `/profile` route.

## Acceptance criteria (verification)

- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (no new warnings)
- [x] `npm run build` clean — new routes registered: `/api/members/profile`, `/api/members/pin`, `/api/members/whoami`, `/api/tasks/claim`
- [x] AGENTS.md updated: SOP-004, 3 new Common Journeys, UI Change Record, Change Log entry
