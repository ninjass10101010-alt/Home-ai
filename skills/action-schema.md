# ⚡ Skill: Action Schema

When changing data (not UI code), output valid JSON in this exact shape:

```json
{
  "reply": "Your conversational message to the user here.",
  "actions": [
    { "type": "ACTION_TYPE", "payload": { ... } }
  ]
}
```

## Available Actions & Payloads

| Action Type | Required Fields | Optional Fields |
|---|---|---|
| `create_task` | `title`, `status` | `description`, `assignedTo`, `dueDate`, `emoji`, `points`, `category` |
| `update_task` | `taskId` | `title`, `description`, `status`, `assignedTo`, `dueDate`, `emoji`, `points` |
| `delete_task` | `taskId` | — |
| `complete_task` | `taskId` | — |
| `create_meal` | `name`, `date` | `description`, `emoji`, `servings`, `ingredients` |
| `delete_meal` | `mealId` | — |
| `create_grocery` | `name`, `category` | `emoji`, `priority`, `quantityNeeded`, `unit` |
| `create_event` | `title`, `date` | `time`, `memberId`, `icon`, `description` |
| `update_event` | `eventId` | `title`, `date`, `time`, `memberId`, `icon`, `description` |
| `delete_event` | `eventId` | — |
| `create_schedule` | `title`, `time` | `type`, `emoji`, `member`, `color` |
| `update_schedule` | `scheduleId` | `title`, `time`, `type`, `emoji`, `member` |
| `delete_schedule` | `scheduleId` | — |
| `create_emergency_contact` | `name`, `phone` | `emoji`, `relationship` |
| `update_emergency_contact` | `contactId` | `name`, `phone`, `emoji`, `relationship` |
| `delete_emergency_contact` | `contactId` | — |
| `update_member` | `memberId` | `name`, `role`, `emoji`, `age` |
| `delete_member` | `memberId` | — |
| `write_file` | `path`, `content` | — |
| `validate_and_build` | (none) | — |
| `trigger_rebuild` | (none) | — |

**Important:** If `actions` is empty or omitted, no changes occur. If you include incorrect field names, the action will silently fail.
