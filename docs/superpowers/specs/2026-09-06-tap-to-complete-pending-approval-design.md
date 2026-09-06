# Tap-to-complete with pending parent approval — design

Date: 2026-09-06. Status: approved for implementation planning.

## Background

Today every task completion, claim, undo, and redemption demands a 4-digit
PIN verified server-side (`verifyPinRemote` in `src/modes/kid/kid-store.ts`).
Secure, but high friction for kids on the shared kitchen screen: each chore
costs a PIN entry. Cozyla's chores system (the "Conzyla" research) wins
adoption the opposite way — a kid taps, stars credit instantly, no ceremony —
at the price of zero accountability (no proof, no undo story, no history).

This spec adopts Cozyla's low friction without surrendering Consuela's
integrity: **trust but verify**. Kids tap to complete PIN-free; the task shows
done and celebrates, but points land in a pending state and only credit when a
parent approves. Rejected taps reopen with nothing awarded.

## Goals / non-goals

Goals: one safe default for all kid completions; an honest ledger (no
unapproved points ever in `weekData.points`); reuse of proven seams (parent
PIN loop, snapshot sync, earn transactions).

Non-goals: push notifications to parents (review happens on next glance, like
every other review surface); changing adult, guest, or universal-claim flows;
a per-task approval toggle; touching the >100pt reward approval gate.

## Locked decisions (from brainstorming Q&A)

1. Scope: kids only — child sessions go PIN-less; adults keep PIN everywhere.
2. Semantics: optimistic done + pending points; a reject reopens with no
   points and no history entries.
3. Surface: parents-only "Needs approval" section on the Tasks page + a
   pending-count badge on the Home Tasks widget.

## Section 1 — Data model

- `Task` gains one optional field:
  `pendingApproval?: { byName: string; at: string /* ISO */; points: number }`
  (`src/types/tasks.ts`). Set on kid tap, cleared on approve or send-back.
  No new collections, no new API routes.
- Invariant: a task with `pendingApproval` set is **done but unpaid** —
  `completed: true` renders normally, but no `earn` transaction exists in
  `weekData.history` and `weekData.points` is untouched.
- New pure helpers in `src/lib/task-utils.ts`: `isPendingApproval(task)` and
  `pendingPointsFor(member, tasks)` (sums a kid's in-flight points for
  "X pts on the way" copy).
- Persistence rides existing rails: `consuela-tasks` localStorage, the PB
  `tasks` row (seed gains the field with the usual self-heal, as `stealable`
  did), and the tasks snapshot — kitchen phone, parents' devices, and kid
  devices converge with no new sync protocol.
- Carve-out: universal/stealable claims keep the existing PIN + server-side
  immediate award, because claiming is competitive (two kids, one prize needs
  the 409 race guard). Pending approval applies to **assigned, non-universal
  completions by child sessions**.

## Section 2 — Kid tap-to-complete flow

- Trigger points keep their locations; behavior changes only when the
  signed-in member's role is `child`: Tasks page rows (tap / swipe-right /
  keyboard) and KidHome quest "Do it" for assigned, non-universal tasks skip
  `verifyPinRemote` entirely.
- On tap: set `completed: true` + `completedBy/At/InWeek` (real values, so
  streaks and regen see truth), attach
  `pendingApproval: { byName, at: nowISO, points }`, persist via the existing
  `saveWeekData` / `syncTasksToPB` paths — **no `earn` tx, no points
  movement**. Confetti + success copy stay; copy frames points as "on the
  way," never as earned.
- Guards carried over: the `completedInWeek` double-tap guard still blocks
  re-completion; a pending row renders "waiting for parent" and its tap is
  disabled (no double-pending).
- Kid self-cancel: the kid who tapped can cancel their own pending completion
  PIN-less (symmetric — it was never verified, so there is nothing to
  un-verify). Reopens the task, drops the pending record.
- Adults, guests, universal/stealable claims: behavior unchanged. Guests keep
  the honest sign-in empty states — a signed-out device can never create a
  pending record.

## Section 3 — Parent approval flow + Home badge

- New **"Needs approval"** section on the Tasks page, rendered only for
  parent sessions (`role === "parent"` — kids and guests never see it, same
  gating as the Ledger widget). Rows show kid avatar + name, task title,
  points, tap time; two buttons: **Approve** and **Send back**.
- Both buttons reuse the existing >100pt-reward parent loop:
  `verifyPinRemote` against each parent in turn, `unreachable` breaks with
  honest copy, PIN clears on both paths. No new auth code.
- **Approve** posts the real `earn` transaction
  (`addTransaction(…, "earn", …, "Completed: {title}", member, taskId)`),
  clears `pendingApproval`, syncs via debounced `syncWeekDataToPB`. From here
  points behave exactly like today's PIN-completed points.
- **Send back** clears `completed`, `completedBy/At/InWeek`, and
  `pendingApproval` — reopened, zero points, zero history entries.
- **Home presence:** the Home Tasks widget header gains a quiet parents-only
  line when the count is nonzero ("N need approval →", linking to `/tasks`).
  No new widget, no push channel.

## Section 4 — Sync, week rollover, edge cases

- Offline / signed-out: optimistic-local plus best-effort sync, flushed on
  sign-in via pending-writes / CacheRefresher paths. No new offline
  machinery.
- Week rollover with items still pending: the record keeps the completion
  week's `completedInWeek`. On approve, if that week is current the `earn` tx
  posts normally; if rolled, it posts to the new week with description
  `"Approved: {title}"` so history stays honest about when points landed.
  Send-back after rollover just reopens.
- Recurring regen treats a pending task as done (reads the `completed` flag),
  so no duplicate clone spawns while approval is outstanding. If sent back,
  normal regen/claim rules apply.
- Undo of an approved completion is today's PIN undo, unchanged. Undo of a
  pending completion by a parent is Send back; by the kid, self-cancel.
- Conflicts: last-write-wins on the task row via shared snapshot sync, and
  the `earn` tx is idempotent by `taskId` (same guard the claim route uses) —
  a double-approve from two devices cannot double-pay.

## Section 5 — Testing

- Unit (task-utils): `isPendingApproval` true/false/edge; `pendingPointsFor`
  per-kid sums ignoring approved/cleared; approve-posts-earn-once
  (idempotent by `taskId`); rollover rule (same-week `"Completed: …"` vs
  new-week `"Approved: …"`); regen treats pending as done.
- Unit (flows): kid tap creates pending with zero `earn` tx and zero points
  movement; guest tap creates nothing; adult tap still demands PIN (existing
  PIN suite stays green untouched); parent approve/send-back require parent
  PIN and clear the record.
- Component: section renders for parents only; Home badge shows count for
  parents, hidden otherwise and at zero; pending rows show "waiting for
  parent" and disable re-tap.
- Cross-device: snapshot round-trip carries `pendingApproval`
  (adopt-on-merge verified here); approve on device A clears pending on
  device B after refresh.
- Gates: full suite green, `tsc` clean, eslint clean on touched files, live
  Playwright probe at 390 + 1280 with zero page errors.

## Contracts to keep (for implementation)

- `verifyPinRemote` (`src/modes/kid/kid-store.ts`) stays the only PIN seam —
  no page-local verifiers.
- Pending points never enter `weekData.points` or `history` until approve.
- `completedInWeek` keeps today's no-double-complete guarantee.
- `isPendingApproval()` is the only pending gate on the client.
- Snapshot merge must adopt `pendingApproval` field changes on known rows —
  verify, do not assume (see Section 1).

## Verification owed to implementation

- Confirm the tasks-snapshot merge adopts `pendingApproval` on known rows
  (add-only merge may skip field updates — check `mergeTasksSnapshot`).
- Confirm PB `tasks` seed self-heal covers the new field on the live
  instance (`npm run pb:seed` pattern).
