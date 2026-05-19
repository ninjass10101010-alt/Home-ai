# 🗄️ Skill: Database Schema

All data lives in PocketBase at `http://192.168.0.27:8090`. Import the client via `import pb from "@/lib/pocketbase"`.

### 1. `members`
| Field | Type | Notes |
|---|---|---|
| `name` | text | Required |
| `role` | text | `mom | dad | son | daughter | other` |
| `emoji` | text | e.g. `👩` |
| `age` | text | Optional |

### 2. `tasks`
| Field | Type | Notes |
|---|---|---|
| `title` | text | Required |
| `status` | text | `pending | in_progress | completed` |
| `assignedTo` | text | `memberId` |
| `dueDate` | text | `YYYY-MM-DD` |
| `points` | number | Default: `10` |

### 3. `meals`
| Field | Type | Notes |
|---|---|---|
| `name` | text | Required |
| `date` | text | `YYYY-MM-DD` (must be today or future) |
| `ingredients` | text | Newline-separated |
| `servings` | number | Default: `4` |

### 4. `events`
| Field | Type | Notes |
|---|---|---|
| `title` | text | Required |
| `date` | text | `YYYY-MM-DD` |
| `time` | text | `HH:MM AM/PM` or empty for All Day |
| `memberId` | text | Optional member reference |

### 5. `schedules`
| Field | Type | Notes |
|---|---|---|
| `title` | text | Required |
| `time` | text | `HH:MM AM/PM` |
| `type` | text | `routine | reminder` |
| `member` | text | Member name (not ID) |
| `color` | text | `green | cyan | violet | amber | rose` |

### 6. `emergency_contacts`
| Field | Type | Notes |
|---|---|---|
| `name` | text | Required |
| `phone` | text | Required, e.g. `+1 313 555 0000` |
| `relationship` | text | e.g. `Doctor | Family | Neighbor` |

### 7. `grocery_items`
| Field | Type | Notes |
|---|---|---|
| `name` | text | Required |
| `category` | text | `produce | dairy | meat | pantry | frozen | snacks | beverages | household` |
| `status` | text | `needed | purchased | suggested` |
| `quantityNeeded` | number | Default: `1` |

### 8. `chat_history` (auto-created)
| Field | Type | Notes |
|---|---|---|
| `role` | text | `user | assistant` |
| `content` | text | Message text |
| `actions` | json | Executed action records |
