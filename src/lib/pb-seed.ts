import { withAdmin } from "./pb-auth";

// SERVER ONLY — the default family PINs, kept here (seed-side truth) so they
// never enter the browser bundle. They are used when a member's PocketBase
// record has no stored pin yet (fresh installs): server-side verification and
// record creation resolve against this map, and any PIN change via
// /api/members/pin persists the real value into PB from then on.
export const MEMBER_DEFAULT_PINS: Record<string, string> = {
  rebecca: "0202",
  jeffery: "0828",
  emily: "1024",
  bailey: "1005",
  jasmine: "0402",
  aurora: "1025",
  caspian: "1010",
  rocco: "0000",
  rico: "0000",
};

export function resolveDefaultMemberPin(name?: string): string {
  const firstName = (name || "").split(" ")[0].toLowerCase();
  return MEMBER_DEFAULT_PINS[firstName] || "";
}

export const COLLECTIONS = [
  {
    name: "members",
    schema: [
      { name: "name", type: "text", required: true },
      // Profile photos are stored inline as base64 data URLs in this field.
      // PocketBase treats a text field's max of 0 as the built-in 5000-char
      // default, which rejected every real photo save (256px webp base64 is
      // ~8-60KB). Keep the explicit max in lockstep with the profile route's
      // MAX_AVATAR_CHARS so the client cap and the DB cap agree.
      { name: "emoji", type: "text", options: { max: 400000 } },
      { name: "color", type: "text" },
      { name: "role", type: "text" },
      { name: "avatarSize", type: "text" },
      { name: "glow", type: "bool" },
      { name: "pin", type: "text" },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "meal_plan_entries",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "time", type: "text" },
      { name: "mealType", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "protein", type: "number" },
      { name: "carbs", type: "number" },
      { name: "fat", type: "number" },
      { name: "recipeId", type: "text" },
      { name: "recipeSnapshotAt", type: "text" },
      { name: "weekOf", type: "text" },
      { name: "date", type: "text" },
      { name: "instructions", type: "text" },
      { name: "image", type: "text" },
    ],
  },
  {
    name: "pantry_items",
    schema: [
      { name: "item", type: "text", required: true },
      { name: "status", type: "select", options: { values: ["plenty", "low", "out"] } },
      { name: "category", type: "text" },
      { name: "quantity", type: "number" },
      { name: "unit", type: "text" },
    ],
  },
  {
    name: "grocery_list_items",
    schema: [
      { name: "userId", type: "text" },
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "category", type: "text" },
      { name: "aisle", type: "text" },
      { name: "quantity", type: "text" },
      { name: "priority", type: "select", options: { values: ["low", "medium", "high"] } },
      { name: "needed", type: "bool" },
      { name: "manualOverride", type: "bool" },
      { name: "source", type: "text" },
      { name: "quantityValue", type: "number" },
      { name: "unit", type: "text" },
      { name: "pinned", type: "bool" },
    ],
  },
  {
    name: "events",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "member", type: "text" },
      { name: "importanceScore", type: "number", required: false, options: { min: 0, max: 100 } },
      { name: "importanceReason", type: "text", required: false },
      { name: "importanceUpdatedAt", type: "date", required: false },
    ],
  },
  {
    name: "emergency_contacts",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "phone", type: "text" },
      { name: "email", type: "text" },
      { name: "carrier", type: "text" },
      { name: "isPrimary", type: "bool" },
    ],
  },
  {
    name: "schedules",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "time", type: "text" },
      { name: "days", type: "text" },
      { name: "type", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "member", type: "text" },
    ],
  },
  {
    name: "auth_sessions",
    schema: [
      { name: "token", type: "text", required: true },
      { name: "memberName", type: "text", required: true },
      { name: "deviceName", type: "text" },
      { name: "ip", type: "text" },
      { name: "createdAt", type: "text" },
      { name: "lastActiveAt", type: "text" },
    ],
  },
  {
    name: "tasks",
    schema: [
      { name: "taskId", type: "number", required: true },
      { name: "title", type: "text", required: true },
      { name: "assignee", type: "text" },
      { name: "assigneeEmoji", type: "text" },
      { name: "due", type: "text" },
      { name: "points", type: "number" },
      { name: "recurring", type: "text" },
      { name: "category", type: "text" },
      { name: "priority", type: "text" },
      { name: "universal", type: "bool" },
      { name: "createdAt", type: "text" },
      { name: "status", type: "select", options: { values: ["pending", "done"] } },
      { name: "completedInWeek", type: "text" },
      { name: "completedAt", type: "text" },
    ],
  },
  {
    name: "week_data",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "taskStates", type: "json" },
      { name: "points", type: "json" },
      { name: "streak", type: "json" },
      { name: "lastActive", type: "json" },
      { name: "history", type: "json" },
    ],
  },
  {
    name: "week_archive",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "archivedAt", type: "text" },
      { name: "points", type: "json" },
      { name: "streak", type: "json" },
      { name: "history", type: "json" },
    ],
  },
  {
    name: "meal_week_archive",
    schema: [
      { name: "weekStart", type: "text", required: true },
      { name: "archivedAt", type: "text" },
      { name: "data", type: "json" },
    ],
  },
  {
    name: "proactive_suggestions",
    schema: [
      { name: "idempotencyHash", type: "text", required: true },
      { name: "kind", type: "select", options: { values: ["pantry_low","task_penalty_streak","calendar_conflict","stale_data","custom"] } },
      { name: "severity", type: "select", options: { values: ["info","warn","alert"] } },
      { name: "title", type: "text", required: true },
      { name: "body", type: "text" },
      { name: "emoji", type: "text" },
      { name: "actionLabel", type: "text" },
      { name: "actionPayload", type: "json" },
      { name: "status", type: "select", options: { values: ["pending","dismissed","actioned","snoozed"] } },
      { name: "snoozedUntil", type: "date" },
      { name: "scopeDate", type: "text", required: true },
      { name: "createdAt", type: "date" },
      { name: "expiresAt", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_hash_unique ON proactive_suggestions (idempotencyHash)",
      "CREATE INDEX idx_status_scope ON proactive_suggestions (status, scopeDate)",
    ],
  },
  {
    name: "morning_briefing",
    schema: [
      { name: "scopeDate", type: "text", required: true },
      { name: "summary", type: "json" },
      { name: "generatedAt", type: "date" },
      { name: "acknowledged", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_scope_unique ON morning_briefing (scopeDate)",
    ],
  },
  {
    name: "chat_messages",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "role", type: "select", options: { values: ["user", "assistant", "system"] } },
      { name: "content", type: "text", required: true },
      { name: "source", type: "select", options: { values: ["telegram", "dashboard", "api"] } },
      { name: "threadId", type: "text", required: true },
      { name: "createdAt", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_thread_created ON chat_messages (threadId, createdAt)",
    ],
  },
  {
    name: "consuela_state",
    schema: [
      { name: "key", type: "text", required: true },
      { name: "value", type: "json" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_key_unique ON consuela_state (key)",
    ],
  },
  // Structured tasks/leaderboard snapshot store used by /api/tasks/sync
  // (previously only created lazily by src/lib/google/pb-collections.ts).
  {
    name: "consuela_data_snapshots",
    schema: [
      { name: "key", type: "text", required: true },
      { name: "data", type: "json" },
      { name: "updated_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_consuela_data_snapshots_key ON consuela_data_snapshots (key)",
    ],
  },
  {
    name: "rewards",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "cost", type: "number" },
    ],
  },
  {
    name: "penalties",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "points", type: "number" },
    ],
  },
  {
    name: "family_goals",
    schema: [
      { name: "title", type: "text" },
      { name: "emoji", type: "text" },
      { name: "targetPoints", type: "number" },
      { name: "reward", type: "text" },
      { name: "weekStart", type: "text" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "hall_of_fame",
    schema: [
      { name: "member", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "weekStart", type: "text", required: true },
      { name: "points", type: "number" },
      { name: "rank", type: "number" },
    ],
  },
  {
    name: "recipes",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "prepTime", type: "text" },
      { name: "cookTime", type: "text" },
      { name: "tags", type: "json" },
      { name: "ingredients", type: "json" },
      { name: "instructions", type: "text" },
      { name: "servings", type: "number" },
      { name: "calories", type: "number" },
      { name: "protein", type: "number" },
      { name: "carbs", type: "number" },
      { name: "fat", type: "number" },
      { name: "source", type: "text" },
      { name: "sourceUrl", type: "text" },
      { name: "difficulty", type: "text" },
      { name: "favorite", type: "bool" },
      { name: "rating", type: "number" },
      { name: "image", type: "text" },
    ],
  },
  {
    name: "ha_entities",
    schema: [
      { name: "entity_id", type: "text", required: true },
      { name: "domain", type: "text", required: true },
      { name: "object_id", type: "text", required: true },
      { name: "friendly_name", type: "text" },
      { name: "area_id", type: "text" },
      { name: "state", type: "text" },
      { name: "attributes", type: "json" },
      { name: "last_updated", type: "text" },
      { name: "source", type: "select", options: { values: ["ha", "mqtt"] } },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_ha_entities_entity ON ha_entities (entity_id)",
    ],
  },
  {
    name: "ha_areas",
    schema: [
      { name: "area_id", type: "text", required: true },
      { name: "name", type: "text" },
      { name: "icon", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "ha_devices",
    schema: [
      { name: "device_id", type: "text", required: true },
      { name: "name", type: "text" },
      { name: "manufacturer", type: "text" },
      { name: "area_id", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "ha_automations",
    schema: [
      { name: "automation_id", type: "text", required: true },
      { name: "name", type: "text" },
      { name: "state", type: "text" },
      { name: "last_triggered", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "ha_notify_config",
    schema: [
      { name: "target", type: "text", required: true },
      {
        name: "channel",
        type: "select",
        options: { values: ["ha", "telegram"] },
      },
      { name: "enabled", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_ha_notify_config_target ON ha_notify_config (target)",
    ],
  },
  {
    name: "ha_notify_prefs",
    schema: [
      { name: "key", type: "text", required: true },
      { name: "enabled", type: "bool" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_ha_notify_prefs_key ON ha_notify_prefs (key)",
    ],
  },
  {
    name: "ha_mirror_state",
    schema: [
      { name: "key", type: "text", required: true },
      { name: "names", type: "json" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_ha_mirror_state_key ON ha_mirror_state (key)",
    ],
  },
  // Services & Keys registry overrides (src/lib/services/*). Secrets stored
  // AES-256-GCM encrypted; absence of a row = .env fallback.
  {
    name: "consuela_service_config",
    schema: [
      { name: "service", type: "text", required: true },
      { name: "key", type: "text", required: true },
      { name: "value", type: "text", required: true },
      { name: "is_secret", type: "bool" },
      { name: "updated_at", type: "text" },
      { name: "updated_by", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_service_config_pair ON consuela_service_config (service, key)",
    ],
  },
  // Skill tree (src/lib/skill-tree.ts). The lib identifies users/branches/
  // quests by plain string ids (e.g. "demo-user"), so id fields are text —
  // NOT relations — and array fields are json.
  {
    name: "skill_tree_profiles",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "totalXP", type: "number" },
      { name: "level", type: "number" },
      { name: "xpToNextLevel", type: "number" },
      { name: "unlockedBranches", type: "json" },
      { name: "completedQuests", type: "json" },
      { name: "activeQuests", type: "json" },
      { name: "achievementCount", type: "number" },
      { name: "currentStreak", type: "number" },
      { name: "longestStreak", type: "number" },
      { name: "lastActivityDate", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_stp_user_id ON skill_tree_profiles (userId)",
    ],
  },
  {
    name: "skill_branches",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "icon", type: "text" },
      { name: "category", type: "text" },
      { name: "color", type: "text" },
      { name: "description", type: "text" },
      { name: "prerequisiteBranches", type: "json" },
      { name: "unlockLevel", type: "number" },
      { name: "unlockXP", type: "number" },
      { name: "questCount", type: "number" },
      { name: "completedCount", type: "number" },
      { name: "order", type: "number" },
      { name: "isDefault", type: "bool" },
      { name: "createdBy", type: "text" },
    ],
    indexes: [],
  },
  {
    name: "quests",
    schema: [
      { name: "branchId", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "type", type: "text" },
      { name: "difficulty", type: "text" },
      { name: "xpReward", type: "number" },
      { name: "requirementType", type: "text" },
      { name: "requirementValue", type: "number" },
      { name: "requirementUnit", type: "text" },
      { name: "status", type: "text" },
      { name: "assignedTo", type: "json" },
      { name: "completedBy", type: "text" },
      { name: "completedAt", type: "text" },
      { name: "approvedBy", type: "text" },
      { name: "approvedAt", type: "text" },
      { name: "proof", type: "text" },
      { name: "order", type: "number" },
      { name: "repeatable", type: "bool" },
      { name: "maxCompletions", type: "number" },
      { name: "completionCount", type: "number" },
      { name: "emoji", type: "text" },
      { name: "isDefault", type: "bool" },
      { name: "createdBy", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_quests_branch_id ON quests (branchId)",
    ],
  },
  {
    name: "achievements",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "icon", type: "text" },
      { name: "category", type: "text" },
      { name: "criteriaType", type: "text" },
      { name: "criteriaValue", type: "number" },
      { name: "criteriaDescription", type: "text" },
      { name: "color", type: "text" },
      { name: "rarity", type: "text" },
      { name: "order", type: "number" },
      { name: "isDefault", type: "bool" },
    ],
    indexes: [],
  },
  {
    name: "user_achievements",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "achievementId", type: "text", required: true },
      { name: "earnedAt", type: "text" },
      { name: "levelAtTime", type: "number" },
      { name: "xpAtTime", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_user_achievements_user_id ON user_achievements (userId)",
    ],
  },
  // Recurring patterns (src/lib/recurring-patterns.ts)
  {
    name: "recurring_patterns",
    schema: [
      { name: "familyId", type: "text", required: true },
      { name: "patternKey", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "category", type: "text" },
      { name: "dayOfWeek", type: "number" },
      { name: "time", type: "text" },
      { name: "duration", type: "number" },
      { name: "occurrences", type: "number" },
      { name: "confidence", type: "number" },
      { name: "lastOccurrence", type: "text" },
      { name: "nextOccurrence", type: "text" },
      { name: "autoScheduleEnabled", type: "bool" },
      { name: "createdAt", type: "text" },
      { name: "updatedAt", type: "text" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_recurring_patterns_key ON recurring_patterns (patternKey)",
    ],
  },
  {
    name: "consuela_family_memories",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "familyId", type: "text" },
      { name: "category", type: "text" },
      { name: "key", type: "text", required: true },
      { name: "content", type: "text", required: true },
      { name: "tags", type: "text" },
      { name: "confidence", type: "number" },
      { name: "usageCount", type: "number" },
      { name: "lastUsed", type: "text" },
      { name: "createdAt", type: "text" },
      { name: "updatedAt", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_family_memories_user ON consuela_family_memories (userId)",
    ],
  },
  // Money Mountain (src/lib/money-mountain.ts) — text userId, no relation to users.
  {
    name: "money_mountains",
    schema: [
      { name: "userId", type: "text", required: true },
      { name: "name", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "targetAmount", type: "number" },
      { name: "currentAmount", type: "number" },
      { name: "currency", type: "text" },
      { name: "imageUrl", type: "text" },
      { name: "icon", type: "text" },
      { name: "color", type: "text" },
      { name: "mountainTheme", type: "text" },
      { name: "status", type: "text" },
      { name: "deadline", type: "text" },
      { name: "isCompleted", type: "bool" },
      { name: "percentageComplete", type: "number" },
      { name: "milestoneIndex", type: "number" },
      { name: "daysActive", type: "number" },
      { name: "matchEnabled", type: "bool" },
      { name: "matchPercentage", type: "number" },
      { name: "matchCap", type: "number" },
      { name: "matchedAmount", type: "number" },
      { name: "totalDeposits", type: "number" },
      { name: "totalWithdrawals", type: "number" },
      { name: "transactionCount", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_money_mountains_user ON money_mountains (userId)",
    ],
  },
  {
    name: "mountain_milestones",
    schema: [
      { name: "mountainId", type: "text", required: true },
      { name: "percentage", type: "number" },
      { name: "label", type: "text" },
      { name: "icon", type: "text" },
      { name: "isReached", type: "bool" },
    ],
    indexes: [
      "CREATE INDEX idx_mountain_milestones_mountain ON mountain_milestones (mountainId)",
    ],
  },
  {
    name: "mountain_transactions",
    schema: [
      { name: "mountainId", type: "text", required: true },
      { name: "userId", type: "text" },
      { name: "type", type: "text" },
      { name: "amount", type: "number" },
      { name: "currency", type: "text" },
      { name: "date", type: "text" },
      { name: "description", type: "text" },
      { name: "source", type: "text" },
      { name: "isMatch", type: "bool" },
      { name: "note", type: "text" },
      { name: "approved", type: "bool" },
      { name: "matchParentId", type: "text" },
      { name: "originalAmount", type: "number" },
      { name: "matchAmount", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_mountain_transactions_mountain ON mountain_transactions (mountainId)",
    ],
  },
  {
    name: "allowance_settings",
    schema: [
      { name: "parentId", type: "text", required: true },
      { name: "childId", type: "text", required: true },
      { name: "weeklyAmount", type: "number" },
      { name: "currency", type: "text" },
      { name: "payDay", type: "number" },
      { name: "matchEnabled", type: "bool" },
      { name: "matchPercentage", type: "number" },
      { name: "requiresApproval", type: "bool" },
      { name: "spendPercent", type: "number" },
      { name: "savePercent", type: "number" },
      { name: "givePercent", type: "number" },
    ],
  },
  // Time Capsule (src/lib/time-capsule.ts) — text createdBy/recipients, no relation.
  {
    name: "time_capsules",
    schema: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "unlockDate", type: "text" },
      { name: "createdBy", type: "text", required: true },
      { name: "recipients", type: "json" },
      { name: "isFamilyWide", type: "bool" },
      { name: "status", type: "text" },
      { name: "contentCount", type: "number" },
      { name: "totalSize", type: "number" },
      { name: "unlockNotificationSent", type: "bool" },
      { name: "viewedBy", type: "json" },
      { name: "unlockMessage", type: "text" },
      { name: "tags", type: "json" },
      { name: "color", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_time_capsules_created ON time_capsules (createdBy)",
    ],
  },
  {
    name: "capsule_contents",
    schema: [
      { name: "capsuleId", type: "text", required: true },
      { name: "type", type: "text" },
      { name: "data", type: "text" },
      { name: "createdBy", type: "text" },
      { name: "caption", type: "text" },
      { name: "order", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_capsule_contents_capsule ON capsule_contents (capsuleId)",
    ],
  },
  // Consuela buffer scheduling settings (src/lib/auto-buffer-scheduling.ts).
  {
    name: "consuela_buffer_settings",
    schema: [
      { name: "userId", type: "text" },
      { name: "settings", type: "json" },
    ],
  },
];

// All browser data traffic now flows through the sessioned /api/db/* gateway
// (src/middleware.ts gates every /api/* route on a valid session cookie), so
// no collection needs public API rules. null = only PB superusers (the
// server-side withAdmin path) may access; "" would mean publicly open.
// All app collections are locked to admin-only and seedCollections() enforces
// that state on every run — any rule drifted away from null is patched back.
const LOCKED_RULES = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

// Every app collection carries the PB-standard created/updated autodate
// fields. The /api/db gateway sorts by -created by default and client code
// relies on record timestamps — a collection without these fields makes
// every sorted read fail (PB 400 → gateway 500 → silent client fallback).
const AUTODATE_CREATED = { name: "created", type: "autodate", onCreate: true };
const AUTODATE_UPDATED = { name: "updated", type: "autodate", onCreate: true, onUpdate: true };

function withAutodate(schema: any[]): any[] {
  const has = (n: string) => schema.some((f: any) => f.name === n);
  const extra: any[] = [];
  if (!has("created")) extra.push({ ...AUTODATE_CREATED });
  if (!has("updated")) extra.push({ ...AUTODATE_UPDATED });
  return extra.length ? [...schema, ...extra] : schema;
}

/** Field builder shared by the create and patch paths. */
function buildField(s: any): any {
  const base: any = { name: s.name, type: s.type };
  if (s.type === "autodate") {
    base.onCreate = s.onCreate !== false;
    if (s.onUpdate) base.onUpdate = true;
    return base;
  }
  base.required = s.required || false;
  if (s.type === "select" && s.options) {
    base.values = s.options.values;
    base.options = s.options;
    if (s.options.maxSelect) base.maxSelect = s.options.maxSelect;
  }
  if (s.type === "json") base.type = "json";
  if (s.type === "number" && s.options) base.options = s.options;
  if (s.type === "date" && s.options) base.options = s.options;
  if (s.type === "text" && s.options) base.options = s.options;
  // generic fallback: preserve any options
  if (s.options && !base.options) base.options = s.options;
  return base;
}

function rulesMatch(live: any): boolean {
  return (
    live.listRule === null &&
    live.viewRule === null &&
    live.createRule === null &&
    live.updateRule === null &&
    live.deleteRule === null
  );
}

export async function seedCollections() {
  const result = await withAdmin(async (pb) => {
    const existing = (await pb.collections.getFullList()).map((c: any) => c.name);
    const created: string[] = [];

    for (const col of COLLECTIONS) {
      const schema = withAutodate(col.schema);
      if (existing.includes(col.name)) {
        const live = (await pb.collections.getFullList()).find((c: any) => c.name === col.name);
        if (!live) {
          created.push(`${col.name} (already exists)`);
          continue;
        }
        const liveFieldNames = new Set((live.fields || []).map((f: any) => f.name));
        const missingFields = schema.filter((s: any) => !liveFieldNames.has(s.name));

        // Field-option drift: fields that exist live but whose options differ
        // from the seed (e.g. members.emoji max — PocketBase treats a text
        // field's max of 0 as the built-in 5000-char default, which rejected
        // every photo-avatar save). Only fields the seed defines an explicit
        // options.max for are healed, so unrelated options are left alone.
        const fieldDrift: any[] = schema
          .filter((s: any) => s.type === "text" && s.options?.max !== undefined && liveFieldNames.has(s.name))
          .map((s: any) => {
            const liveField = (live.fields || []).find((f: any) => f.name === s.name);
            return liveField && liveField.max !== s.options.max
              ? { schemaField: s, liveField }
              : null;
          })
          .filter(Boolean);

        const liveIndexNames = new Set(
          (live.indexes || []).map((i: any) => {
            if (typeof i === "string") {
              const match = i.match(/INDEX\s+(\S+)\s+ON/i);
              return match ? match[1] : i;
            }
            return i.name;
          })
        );
        const missingIndexes = (col.indexes || []).filter((i: any) => {
          const name = typeof i === "string"
            ? ((i.match(/INDEX\s+(\S+)\s+ON/i) || [])[1] || i)
            : i.name;
          return !liveIndexNames.has(name);
        });

        if (missingFields.length || missingIndexes.length || fieldDrift.length) {
          const parts: string[] = [];
          if (missingFields.length || fieldDrift.length) {
            const mergedFields = [
              ...(live.fields || []),
              ...missingFields.map(buildField),
            ];
            for (const d of fieldDrift) {
              const lf = mergedFields.find((f: any) => f.name === d.schemaField.name);
              if (lf) lf.max = d.schemaField.options.max;
            }
            await pb.collections.update(live.id, { fields: mergedFields });
            if (missingFields.length) {
              parts.push(`+${missingFields.length} fields: ${missingFields.map((m: any) => m.name).join(", ")}`);
            }
            if (fieldDrift.length) {
              parts.push(`+${fieldDrift.length} field options (${fieldDrift.map((d: any) => d.schemaField.name).join(", ")})`);
            }
          }
          if (missingIndexes.length) {
            await pb.collections.update(live.id, { indexes: [...(live.indexes || []), ...missingIndexes] });
            parts.push(`+${missingIndexes.length} indexes: ${missingIndexes.map((i: any) => typeof i === "string" ? ((i.match(/INDEX\s+(\S+)\s+ON/i) || [])[1] || i) : i.name).join(", ")}`);
          }
          created.push(`${col.name} (patched ${parts.join(", ")})`);
        } else {
          created.push(`${col.name} (already exists)`);
        }
        if (!rulesMatch(live)) {
          await pb.collections.update(live.id, { ...LOCKED_RULES });
          created[created.length - 1] += " (locked)";
        }
        continue;
      }
      await pb.collections.create({
        name: col.name,
        type: "base",
        ...LOCKED_RULES,
        fields: schema.map(buildField),
        indexes: col.indexes || [],
      });
      created.push(col.name);
    }

    return created;
  });

  console.log("PocketBase collections:", result.join(", "));
  return result;
}
