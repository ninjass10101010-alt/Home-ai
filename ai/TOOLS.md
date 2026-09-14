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
| `get_weather` | Today's REAL live weather (Open-Meteo, °F): temp, feels-like, high/low, condition, precip chance | "What's the weather?" — if it errors, weather data is unavailable |
| `get_proactive_suggestions` | Pending alerts: pantry lows, streaks, conflicts | "What did you notice?" |

## Write Tools (parents only — kids never receive these)

| Tool | What it does | Pattern |
|------|-------------|---------|
| `add_task` | Create a chore (title, assignee, points, due, priority, recurring, stealable) | Unknown assignees are refused — resolve the name with `get_family_members` first |
| `update_task` | Edit a pending task (title, assignee, points, due, priority, recurring, stealable) | Find by taskId or exact title |
| `delete_task` | Remove a pending task permanently | Completed rows can't be deleted — undo them in the Tasks UI instead |
| `reopen_task` | Reopen a completed task still waiting in the approval queue | Already-paid completions: undo in the Tasks UI (parent PIN), not here |
| `complete_task` | Mark a chore done — queues for parent approval; you never move points | Only when the user confirms completion |
| `add_event` | Schedule a calendar event | Run `check_conflicts` FIRST when a date+time is set |
| `update_event` | Move or edit a family event (date, time, title, member) | Google-synced events are edited on Google's side, not with this tool |
| `remove_event` | Remove an event by title (+optional date) | Echo what was removed |
| `add_meal` | Upsert a day+mealType slot (upsert — never overwrites blindly) | Day accepts Mon..Sun or YYYY-MM-DD |
| `add_grocery_item` | Add item(s) to the shopping list | Dedupe against the current list first |
| `add_recipe` | Save a recipe to the family recipe box (name, comma-separated ingredients, optional tags/times/servings/calories/instructions/source) | Ingredients and tags are comma lists — they store as JSON-stringified arrays like the UI path |
| `recipe_ingredients_to_grocery` | Add one recipe's missing ingredients to the shopping list | Exact recipe name from `get_recipes`; skips anything already in the pantry or on the list and reports what was skipped |
| `complete_grocery_item` | Mark an item picked up | |
| `add_pantry_item` | Add or update pantry stock (upsert by name) | Quantity is the NEW total after cooking — not the amount used |
| `remove_pantry_item` | Remove a pantry item by exact name | Refuses honestly when nothing matches |
| `add_schedule_item` | Add a weekly routine (title, 12-hour time, day scope) | days: weekdays / weekends / daily / "mon,wed,fri" |
| `update_schedule_item` | Patch a routine by exact title | Ambiguous or missing titles are refused — check `get_family_routines` first |
| `delete_schedule_item` | Delete a routine by exact title | Ambiguous or missing titles are refused |
| `dismiss_suggestion` | Dismiss a proactive alert | |
| `action_suggestion` | Run a suggestion's attached action | |

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
