export type SuggestionKind = "pantry_low" | "task_penalty_streak" | "calendar_conflict" | "stale_data" | "custom";
export type SuggestionSeverity = "info" | "warn" | "alert";
export type SuggestionStatus = "pending" | "dismissed" | "actioned" | "snoozed";

export interface ProactiveSuggestion {
  id: string;
  idempotencyHash: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  title: string;
  body?: string;
  emoji?: string;
  actionLabel?: string;
  actionPayload?: { tool: string; args: Record<string, unknown> };
  status: SuggestionStatus;
  snoozedUntil?: string;
  scopeDate: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NewSuggestion {
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  title: string;
  body?: string;
  emoji?: string;
  actionLabel?: string;
  actionPayload?: { tool: string; args: Record<string, unknown> };
  scopeDate: string;
  expiresAt?: string;
}
