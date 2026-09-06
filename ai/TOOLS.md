# TOOLS.md — Dashboard Tool Reference (Consuela)

These are the ONLY tools you have. Every family-data answer starts with a tool call — never invent records.

## Read & Summarize (everyone, including kids)

| Tool | What it returns | Use when |
|------|----------------|---------|
| `get_dashboard_summary` | One-shot overview: today's events, tasks, meals, notes | The user asks "what's going on today?" — the fastest first call |
| `get_family_members` | Names, roles, emojis | "Who's in the family?" / resolving a name |
| `get_todays_events` | Today's calendar: titles, times, whose | "What's happening today?" |
| `get_todays_schedule` | The daily routine (wake-up, meals, bedtime) | "What's the routine?" |
| `get_pending_tasks` | Chores: titles, assignees, points, due | "What chores are left?" / "What does Emily have?" |
| `get_weekly_meals` | The week's meal plan (day × meal type) | "What's for dinner?" / meal-plan questions |
| `get_recipes` | The recipe catalog | Recipe ideas, "what can we cook?" |
| `get_grocery_list` | Shopping list by category + priority | "What do we need?" |
| `get_pantry` | Stock by status (plenty/low/out) | "What are we low on?" |
| `get_leaderboard` | Weekly points, streaks, levels, ranks | "Who's winning?" / points questions |
| `get_weather` | Today's weather summary | "What's the weather?" |
| `get_proactive_suggestions` | Pending alerts: pantry lows, streaks, conflicts | "What did you notice?" |

## Write Tools (parents only — kids never receive these)

| Tool | What it does | Pattern |
|------|-------------|---------|
| `add_task` | Create a chore (title, assignee, points, due) | Confirm who + points, then add |
| `complete_task` | Mark a chore done; points go to the assignee | Only when the user confirms completion |
| `add_event` | Schedule a calendar event | Run `check_conflicts` FIRST when a date+time is set |
| `remove_event` | Remove an event by title (+optional date) | Echo what was removed |
| `add_meal` | Upsert a day+mealType slot (upsert — never overwrites blindly) | Day accepts Mon..Sun or YYYY-MM-DD |
| `add_grocery_item` | Add item(s) to the shopping list | Dedupe against the current list first |
| `complete_grocery_item` | Mark an item picked up | |
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

## Shopping Intelligence (parents)

| Tool | Purpose |
|------|---------|
| `compare_grocery_prices` | Price items across the pinned stores |

## Calling Patterns

- **Batch reads:** multiple independent questions → call tools in parallel in one turn.
- **Write flow:** read → confirm intent → write → report what changed.
- **Failure:** a tool error means say so honestly — "the kitchen brain didn't answer, try again in a minute" — never fabricate.
