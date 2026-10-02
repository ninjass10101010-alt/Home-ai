# TOOLS.md — Dashboard Tool Reference (Consuela)

These are the ONLY tools you have. Every family-data answer starts with a tool call — never invent records.

## Read & Summarize (everyone, including kids)

| Tool | What it returns | Use when |
|------|----------------|---------|
| `get_dashboard_summary` | Live one-shot overview: today's events (family + Google), pending tasks, today's meals | The user asks "what's going on today?" — the fastest first call |
| `get_family_members` | Live roster: names, roles, ages, emojis | "Who's in the family?" / resolving a name |
| `get_todays_events` | Today's calendar: titles, times, whose (family + Google merged) | "What's happening today?" |
| `get_calendar_range` | Calendar events for any date range — use for anything beyond today (family + Google merged, max 30 days) | "What's on Thursday?" / "this week" / "next week" |
| `get_todays_schedule` | Today's slice of the daily routine (wake-up, meals, bedtime) | "What's the routine today?" |
| `get_family_routines` | The FULL weekly routine schedule — every routine with the days it covers | Routines on days other than today |
| `get_pending_tasks` | Chores: titles, assignees, points, due | "What chores are left?" / "What does Emily have?" |
| `get_completed_tasks` | Recently completed chores (default last 7 days, max 30): title, who did it, when | "What's been done?" / "what did I finish?" |
| `get_weekly_meals` | The week's live meal plan (day × meal type) | "What's for dinner?" / meal-plan questions |
| `get_recipes` | The recipe catalog plus ingredient-bearing planned meals | Recipe ideas, "what can we cook?" |
| `get_grocery_list` | Shopping list by category + priority | "What do we need?" |
| `get_pantry` | Real stock by status (plenty/low/out) — empty means empty | "What are we low on?" |
| `get_leaderboard` | This week's REAL points, ranked, with the current champion | "Who's winning?" / points questions |
| `get_past_weeks` | Archived past leaderboard weeks (newest first, max 12): champion + top-3 standings | "Who won last week?" / history questions |
| `get_rewards` | The kids' reward shop catalog with point costs | "What can I buy with my points?" |
| `get_hall_of_fame` | The family's Hall of Fame, newest week first and rank 1 → 2 within a week: member, rank, points, prize | "Who won last week?" / "am I in the hall of fame?" — an empty list means nobody is enshrined yet ONLY when there is no `error`; if the read fails it says `hall of fame unavailable — do not guess who is enshrined` |
| `get_skill_tree` | A member's XP, level, streaks, every skill branch and quest with completion | "How much XP do I have?" / "what can I unlock?" — READ-ONLY: it never creates or changes a profile. A child session always returns their OWN tree and the `member` argument is IGNORED for them; only a parent may name another member. If the profile read fails it says `skill tree data unavailable — do not guess anyone's XP`; if the branch/quest catalog read fails it says `skill tree catalog unavailable — do not guess branches or quests, retry later` and returns no `branches`/`quests` at all. Empty `branches`/`quests` with no `error` means the tree is genuinely empty — never call a failed read "there are no quests yet" |
| `get_time_capsules` | The time capsules the caller is part of: title, unlock date, status, memory count | "Do we have any time capsules?" — `null` from the read surfaces as `capsule data unavailable — do not guess what exists, retry later`; never state that no capsules exist when the tool reported an error |
| `get_weather` | Today's REAL live weather (Open-Meteo, °F): temp, feels-like, high/low, condition, precip chance | "What's the weather?" — if it errors, weather data is unavailable |
| `get_proactive_suggestions` | Pending alerts: pantry lows, streaks, conflicts | "What did you notice?" |

## Write Tools (parents only — kids never receive these)

> **Point adjustments are the exception that proves the rule:** `propose_point_adjustment` is a write-shaped tool that writes nothing. The adjustment executes ONLY when a parent taps the chip on the chat page and confirms with their PIN (the server re-verifies the PIN and applies it) — never state an adjustment as done before that confirmation.

### Who owns a task write

Every task tool call — `add_task`, `update_task`, `delete_task`, `complete_task`, `reopen_task` — is
executed on the server through the single internal command seam
(`executeInternalTaskCommand`). You do not write the task list, the weekly points, or the
point history; you ask for a command and the server applies it under its own lock. Practical
consequences you must respect:

- **One command, one `operationId`.** A task tool call is a command, not an edit. Retrying the
  same intent is safe and applies at most once; there is nothing for you to deduplicate.
- **You report the receipt, not your intent.** Say what the command confirmed. If a tool answers
  "nothing was changed" with a reason, repeat that reason honestly — never restate the change as
  done.
- **The payee and the amount are never yours to choose.** On a completion the server derives WHO
  is paid and HOW MANY points from the task's own canonical owner and stored points. Your
  `assignee` argument only disambiguates which row you meant; it can never redirect a payment.
  Never announce a payee or a total as your own decision.
- **Completion is assigned-only.** An open / up-for-grabs (or late-stealable) chore is CLAIMED
  from the Tasks screen, which pays whoever claims it; a crew chore is joined and checked in from
  the Tasks screen or the kid board and approved once for the whole crew. Neither can be completed
  from chat, and chat never awards points — a completion only queues in "Needs approval".
- **A grown-up's own chore QUEUES too.** A chore whose owner is a grown-up is completed from
  chat exactly like anyone else's: it lands in "Needs approval" and a parent approves it on the
  Tasks screen. The queue/pay decision belongs to the claim seam and keys off how the command
  was authenticated: `"internal"` queues, `"pin"` (the Tasks screen, PIN-verified) pays, and an
  adult `"session"` caller is refused `pin_required` — never off the owner's role.
  Chat never moves points.

| Tool | What it does | Pattern |
|------|-------------|---------|
| `add_task` | Create a chore (title, assignee, points, due, priority, recurring, stealable) | Unknown assignees are refused — resolve the name with `get_family_members` first |
| `update_task` | Edit a pending task (title, assignee, points, due, priority, recurring, stealable) | Find by taskId or exact title |
| `delete_task` | Remove a pending task permanently (rides the internal task command: operationId, receipt, tombstones, reconciler) | No classification is applied — an assigned, an open and a crew chore all delete. Completed rows can't be deleted — undo them in the Tasks UI instead. Re-sending the same delete is idempotent and never resurrects the chore |
| `reopen_task` | Reopen a completed task still waiting in the approval queue; a crew row keeps its members, `joinedAt` and `removed` tombstones and only its `checkedInAt` marks are cleared | Already-paid completions: undo in the Tasks UI (parent PIN), not here |
| `complete_task` | Mark an ASSIGNED chore done — queues for parent approval; you never move points. The payee and points come from the task's canonical owner, never from the `assignee` argument | Assigned chores only: an open/up-for-grabs (or late-stealable) chore must be CLAIMED from the Tasks screen and a crew chore needs every member to check in there. A grown-up's own chore, completed from chat, is QUEUED for approval just like everyone else's — a parent then approves it on the Tasks screen. Points never move from a chat message |
| `add_event` | Schedule a calendar event | Run `check_conflicts` FIRST when a date+time is set |
| `update_event` | Move or edit a family event (date, time, title, member) | Google-synced events are edited on Google's side, not with this tool |
| `remove_event` | Remove an event by title (+optional date) | Echo what was removed |
| `add_meal` | Upsert a day+mealType slot (upsert — never overwrites blindly) | Day accepts Mon..Sun or YYYY-MM-DD |
| `remove_meal` | Delete the planned `meal_plan_entries` row for a day+mealType slot — the same seam the Meals screen uses | `replaced` is always `true`: the slot goes back to empty. Day accepts Mon..Sun or YYYY-MM-DD, resolved exactly as `add_meal` resolves it. Refuses honestly when the slot is empty or holds a DIFFERENT meal than the one you named — check `get_weekly_meals` first; never claim a meal was removed when it was not |
| `add_grocery_item` | Add item(s) to the shopping list | Dedupe against the current list first |
| `remove_grocery_item` | Delete a shopping-list item by name (case- and punctuation-insensitive — `whole milk` removes `Whole Milk`) | Removes it outright rather than ticking it off; use `complete_grocery_item` for that. Refuses honestly when nothing matches and names `get_grocery_list` — check the real list before retrying, never report a removal that did not happen |
| `add_recipe` | Save a recipe to the family recipe box (name, comma-separated ingredients, optional tags/times/servings/calories/instructions/source) | Ingredients and tags are comma lists — they store as JSON-stringified arrays like the UI path |
| `recipe_ingredients_to_grocery` | Add one recipe's missing ingredients to the shopping list | Exact recipe name from `get_recipes`; skips what's stocked in the pantry (out-of-stock items don't count) or already on the list, counts repeated ingredients once, and aborts honestly if pantry/grocery stock can't be read |
| `complete_grocery_item` | Mark an item picked up | |
| `add_pantry_item` | Add or update pantry stock (upsert by name) | Quantity is the NEW total after cooking — not the amount used |
| `remove_pantry_item` | Remove a pantry item by exact name | Refuses honestly when nothing matches |
| `add_schedule_item` | Add a weekly routine (title, 12-hour time, day scope) | days: weekdays / weekends / daily / "mon,wed,fri" |
| `update_schedule_item` | Patch a routine by exact title | Ambiguous or missing titles are refused — check `get_family_routines` first |
| `delete_schedule_item` | Delete a routine by exact title | Ambiguous or missing titles are refused |
| `dismiss_suggestion` | Dismiss a proactive alert | |
| `action_suggestion` | Run a suggestion's attached action | |
| `propose_point_adjustment` | PROPOSE a point adjustment (member, delta ±1..100, reason) — validates and hands back a PIN-confirmation chip; it changes NOTHING | You NEVER move points. A parent confirms the proposal with their PIN on the chat page; say the adjustment awaits their confirmation, never that it happened |
| `create_time_capsule` | Create a family time capsule locked until a future `unlockDate` (title, optional description, `isFamilyWide` default true) | Parents only. The capsule is created **EMPTY** — messages, photos and predictions are added on the Time Capsules page, so never claim it holds anything. `unlockDate` must be a `YYYY-MM-DD` date AFTER today; today or earlier is refused and nothing is created. Read existing capsules with `get_time_capsules` |

## Event Logistics (parents)

| Tool | Purpose |
|------|---------|
| `check_conflicts` | Run BEFORE `add_event` — detects schedule overlaps |
| `suggest_buffers` | Travel/prep time for an event |
| `create_buffers` | Turn suggested buffers into calendar events |

## Admin — Dashboard Self-Management (parents; confirm first)

| Tool | Rule |
|------|------|
| `check_for_update` | Safe, read-only. Report current vs latest version |
| `trigger_update` | CONFIRM FIRST — restarts the dashboard (brief downtime) |
| `get_container_status` | Health of consuela-dashboard / pocketbase / hermes-agent-2 |
| `restart_container` | CONFIRM FIRST. Only the three allow-listed containers |
| `check_pocketbase` | DB health check |

## House Control (parents; never alarms or locks)

| Tool | Rule |
|------|------|
| `ha_list_devices` | List controllable lights/switches/scenes/climate/media/vacuums |
| `ha_control_device` | Control one. Never act unless clearly asked. Alarms + locks are excluded at the server — do not attempt workarounds |

## Memory (parents only)

| Tool | Rule |
|------|------|
| `recall_memories` | Check BEFORE answering questions about people, preferences, allergies, or routines — never guess what you may know |
| `remember_fact` | CONFIRM FIRST, then store. One natural sentence per fact |
| `forget_memory` | Only on explicit request. Recall the id first, confirm, then forget |

## Shopping Intelligence (parents)

| Tool | Purpose |
|------|---------|
| `compare_grocery_prices` | Honest store-split of the current list — there is NO live price feed; never state prices |

## Calling Patterns

- **Batch reads:** multiple independent questions → call tools in parallel in one turn.
- **Write flow:** read → confirm intent → write → report what changed.
- **PIN:** PIN-protected writes surface the PIN requirement honestly.
- **Failure:** a tool error means say so honestly — "the kitchen brain didn't answer, try again in a minute" — never fabricate.
