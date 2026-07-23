/**
 * Family AI (Consuela) - Database Types
 * 
 * Context-aware AI assistant that understands family context, learns preferences,
 * and provides proactive suggestions. The crown jewel feature.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export type IntentType = 
  | 'question'          // Asking about schedule, events, etc.
  | 'action'            // Requesting an action (add event, set reminder)
  | 'suggestion'        // Asking for suggestions (dinner, activities)
  | 'planning'          // Planning something (party, vacation)
  | 'check_in'          // General check-in, greeting
  | 'feedback'          // Giving feedback on suggestions
  | 'other';

export type ActionType = 
  | 'add_event'
  | 'set_reminder'
  | 'create_checklist'
  | 'send_message'
  | 'play_music'
  | 'order_groceries'
  | 'search_products'
  | 'log_learning'
  | 'log_points'
  | 'other';

export type SuggestionTrigger = 
  | 'time_based'        // Time of day triggers
  | 'event_based'       // Calendar event triggers
  | 'weather_based'     // Weather condition triggers
  | 'behavior_based'    // User behavior patterns
  | 'schedule_gap'      // Free time detected
  | 'upcoming_event'    // Event approaching
  | 'preference_match'  // Matches user preferences
  | 'manual';           // Manually triggered

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'snoozed' | 'expired';

export type FeedbackType = 'positive' | 'negative' | 'neutral';

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  userId: string;
  title?: string; // Auto-generated from first message
  startedAt: string;
  lastMessageAt: string;
  
  // Context
  familyContextSnapshot?: FamilyContextSnapshot;
  
  // Stats
  messageCount: number;
  actionCount: number;
  
  // State
  isActive: boolean;
  archivedAt?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  
  // Metadata
  createdAt: string;
  
  // Parsed intent (for user messages)
  intentType?: IntentType;
  intentConfidence?: number; // 0-1
  mentionedMembers?: string[]; // user IDs
  referencedEvents?: string[]; // event IDs
  referencedDates?: string[]; // ISO dates
  
  // Actions (for assistant messages)
  actions?: ConversationAction[];
  
  // Context used for this message
  contextUsed?: string[]; // list of context sources
  
  // Token usage
  promptTokens?: number;
  completionTokens?: number;
  
  // Feedback
  feedback?: FeedbackType;
  feedbackAt?: string;
}

export interface ConversationAction {
  id: string;
  messageId: string;
  type: ActionType;
  payload: Record<string, any>;
  
  // State
  status: 'proposed' | 'confirmed' | 'executed' | 'failed';
  confirmedAt?: string;
  executedAt?: string;
  failedAt?: string;
  failureReason?: string;
  
  // Result
  result?: Record<string, any>;
  
  createdAt: string;
}

export interface FamilyContextSnapshot {
  // Members
  familyMembers: FamilyMemberInfo[];
  
  // Schedule
  todaysEvents: EventInfo[];
  upcomingEvents: EventInfo[];
  
  // Preferences
  dietaryRestrictions: string[];
  favoriteActivities: string[];
  preferredCommunication: string;
  
  // Active items
  activeQuests: string[];
  activeGoals: string[];
  pendingReminders: string[];
  
  // Recent history
  recentConversations: number;
  recentActions: number;
  
  // Time context
  currentDateTime: string;
  dayOfWeek: string;
  isWeekend: boolean;
  isBedtime: boolean;
  isMorning: boolean;
  
  // Weather
  weatherCondition?: string;
  temperature?: number;
}

export interface FamilyMemberInfo {
  id: string;
  name: string;
  role: 'parent' | 'child' | 'pet';
  age?: number;
  preferences?: string[];
}

export interface EventInfo {
  id: string;
  title: string;
  time: string;
  location?: string;
  attendees?: string[];
  type?: string;
}

// ─── Proactive Suggestions ───────────────────────────────────────────────────

export interface ProactiveSuggestion {
  id: string;
  userId: string;
  
  // Content
  title: string;
  message: string;
  emoji?: string;
  
  // Trigger
  triggerType: SuggestionTrigger;
  triggerData?: Record<string, any>;
  
  // Actions
  actions: SuggestionAction[];
  
  // State
  status: SuggestionStatus;
  snoozedUntil?: string;
  
  // Tracking
  shownAt: string;
  actedAt?: string;
  expiresAt?: string;
  
  // Feedback
  feedback?: FeedbackType;
  feedbackAt?: string;
  
  // Priority
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  createdAt: string;
}

export interface SuggestionAction {
  label: string;
  type: 'accept' | 'dismiss' | 'snooze' | 'custom';
  payload?: Record<string, any>;
  icon?: string; // emoji
  isPrimary?: boolean;
}

// ─── AI Preferences & Training ───────────────────────────────────────────────

export interface AIPreference {
  id: string;
  userId: string;
  
  // Communication style
  preferredTone: 'casual' | 'formal' | 'playful' | 'concise';
  emojiUsage: 'minimal' | 'moderate' | 'frequent';
  responseLength: 'brief' | 'moderate' | 'detailed';
  
  // Proactive suggestions
  enableProactiveSuggestions: boolean;
  suggestionFrequency: 'low' | 'medium' | 'high';
  quietHoursStart?: string; // "22:00"
  quietHoursEnd?: string;   // "07:00"
  
  // Privacy
  shareCalendarContext: boolean;
  shareLocationContext: boolean;
  sharePreferenceContext: boolean;
  
  // Learning
  allowLearningFromFeedback: boolean;
  allowConversationHistory: boolean;
  
  // Custom instructions
  customInstructions?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface ConversationFeedback {
  id: string;
  messageId: string;
  userId: string;
  
  type: FeedbackType;
  comment?: string;
  
  // What was wrong (for negative feedback)
  issueType?: 'inaccurate' | 'unhelpful' | 'inappropriate' | 'too_verbose' | 'too_brief' | 'other';
  
  createdAt: string;
}

// ─── PocketBase Collection Schemas ───────────────────────────────────────────

export const conversationsSchema = {
  name: 'conversations',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'title', type: 'text', required: false },
    { name: 'startedAt', type: 'date', required: true },
    { name: 'lastMessageAt', type: 'date', required: true },
    { name: 'familyContextSnapshot', type: 'json', required: false },
    { name: 'messageCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'actionCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'isActive', type: 'bool', required: true, defaultValue: true },
    { name: 'archivedAt', type: 'date', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_conversations_user_id ON conversations (userId)',
    'CREATE INDEX idx_conversations_is_active ON conversations (isActive)',
    'CREATE INDEX idx_conversations_last_message ON conversations (lastMessageAt)',
  ],
};

export const conversationMessagesSchema = {
  name: 'conversation_messages',
  type: 'base',
  fields: [
    { name: 'conversationId', type: 'relation', required: true, collectionId: 'conversations', cascadeDelete: true },
    { name: 'role', type: 'select', required: true, values: ['user', 'assistant', 'system'] },
    { name: 'content', type: 'text', required: true },
    { name: 'intentType', type: 'select', required: false, values: ['question', 'action', 'suggestion', 'planning', 'check_in', 'feedback', 'other'] },
    { name: 'intentConfidence', type: 'number', required: false },
    { name: 'mentionedMembers', type: 'json', required: false },
    { name: 'referencedEvents', type: 'json', required: false },
    { name: 'referencedDates', type: 'json', required: false },
    { name: 'actions', type: 'json', required: false },
    { name: 'contextUsed', type: 'json', required: false },
    { name: 'promptTokens', type: 'number', required: false },
    { name: 'completionTokens', type: 'number', required: false },
    { name: 'feedback', type: 'select', required: false, values: ['positive', 'negative', 'neutral'] },
    { name: 'feedbackAt', type: 'date', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_conv_messages_conversation_id ON conversation_messages (conversationId)',
    'CREATE INDEX idx_conv_messages_role ON conversation_messages (role)',
    'CREATE INDEX idx_conv_messages_created_at ON conversation_messages (created)',
  ],
};

export const proactiveSuggestionsSchema = {
  name: 'proactive_suggestions',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'title', type: 'text', required: true },
    { name: 'message', type: 'text', required: true },
    { name: 'emoji', type: 'text', required: false },
    { name: 'triggerType', type: 'select', required: true, values: ['time_based', 'event_based', 'weather_based', 'behavior_based', 'schedule_gap', 'upcoming_event', 'preference_match', 'manual'] },
    { name: 'triggerData', type: 'json', required: false },
    { name: 'actions', type: 'json', required: true },
    { name: 'status', type: 'select', required: true, values: ['pending', 'accepted', 'dismissed', 'snoozed', 'expired'], defaultValue: 'pending' },
    { name: 'snoozedUntil', type: 'date', required: false },
    { name: 'shownAt', type: 'date', required: true },
    { name: 'actedAt', type: 'date', required: false },
    { name: 'expiresAt', type: 'date', required: false },
    { name: 'feedback', type: 'select', required: false, values: ['positive', 'negative', 'neutral'] },
    { name: 'feedbackAt', type: 'date', required: false },
    { name: 'priority', type: 'select', required: true, values: ['low', 'medium', 'high', 'urgent'], defaultValue: 'medium' },
  ],
  indexes: [
    'CREATE INDEX idx_proactive_suggestions_user_id ON proactive_suggestions (userId)',
    'CREATE INDEX idx_proactive_suggestions_status ON proactive_suggestions (status)',
    'CREATE INDEX idx_proactive_suggestions_shown_at ON proactive_suggestions (shownAt)',
    'CREATE INDEX idx_proactive_suggestions_priority ON proactive_suggestions (priority)',
  ],
};

export const aiPreferencesSchema = {
  name: 'ai_preferences',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'preferredTone', type: 'select', required: true, values: ['casual', 'formal', 'playful', 'concise'], defaultValue: 'casual' },
    { name: 'emojiUsage', type: 'select', required: true, values: ['minimal', 'moderate', 'frequent'], defaultValue: 'moderate' },
    { name: 'responseLength', type: 'select', required: true, values: ['brief', 'moderate', 'detailed'], defaultValue: 'moderate' },
    { name: 'enableProactiveSuggestions', type: 'bool', required: true, defaultValue: true },
    { name: 'suggestionFrequency', type: 'select', required: true, values: ['low', 'medium', 'high'], defaultValue: 'medium' },
    { name: 'quietHoursStart', type: 'text', required: false },
    { name: 'quietHoursEnd', type: 'text', required: false },
    { name: 'shareCalendarContext', type: 'bool', required: true, defaultValue: true },
    { name: 'shareLocationContext', type: 'bool', required: true, defaultValue: false },
    { name: 'sharePreferenceContext', type: 'bool', required: true, defaultValue: true },
    { name: 'allowLearningFromFeedback', type: 'bool', required: true, defaultValue: true },
    { name: 'allowConversationHistory', type: 'bool', required: true, defaultValue: true },
    { name: 'customInstructions', type: 'text', required: false },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_ai_preferences_user_id ON ai_preferences (userId)',
  ],
};

export const conversationFeedbackSchema = {
  name: 'conversation_feedback',
  type: 'base',
  fields: [
    { name: 'messageId', type: 'relation', required: true, collectionId: 'conversation_messages', cascadeDelete: true },
    { name: 'userId', type: 'relation', required: true, collectionId: 'users' },
    { name: 'type', type: 'select', required: true, values: ['positive', 'negative', 'neutral'] },
    { name: 'comment', type: 'text', required: false },
    { name: 'issueType', type: 'select', required: false, values: ['inaccurate', 'unhelpful', 'inappropriate', 'too_verbose', 'too_brief', 'other'] },
  ],
  indexes: [
    'CREATE INDEX idx_conv_feedback_message_id ON conversation_feedback (messageId)',
    'CREATE INDEX idx_conv_feedback_user_id ON conversation_feedback (userId)',
    'CREATE INDEX idx_conv_feedback_type ON conversation_feedback (type)',
  ],
};

// ─── System Prompt Templates ─────────────────────────────────────────────────

export function buildSystemPrompt(context: FamilyContextSnapshot, preferences: AIPreference): string {
  const membersList = context.familyMembers
    .map(m => `- ${m.name} (${m.role}${m.age ? `, ${m.age} years old` : ''})`)
    .join('\n');
  
  const eventsList = context.todaysEvents
    .map(e => `- ${e.time}: ${e.title}${e.location ? ` at ${e.location}` : ''}`)
    .join('\n');
  
  return `You are Consuela, a warm and helpful family AI assistant for the ${context.familyMembers.length}-person family.

## FAMILY MEMBERS
${membersList}

## CURRENT TIME
${context.currentDateTime} (${context.dayOfWeek})
${context.isWeekend ? '🎉 It\'s the weekend!' : ''}
${context.isBedtime ? '🌙 It\'s bedtime wind-down time.' : ''}
${context.isMorning ? '☀️ Good morning!' : ''}

## TODAY'S SCHEDULE
${eventsList || 'No events scheduled today.'}

## WEATHER
${context.weatherCondition ? `${context.weatherCondition}, ${context.temperature}°F` : 'Weather data unavailable.'}

## ACTIVE GOALS & REMINDERS
${context.activeGoals.length > 0 ? `Goals: ${context.activeGoals.join(', ')}` : 'No active goals.'}
${context.pendingReminders.length > 0 ? `Reminders: ${context.pendingReminders.join(', ')}` : 'No pending reminders.'}

## YOUR PERSONALITY
- Friendly, warm, and conversational
- Use emojis ${preferences.emojiUsage === 'minimal' ? 'sparingly' : preferences.emojiUsage === 'frequent' ? 'generously' : 'moderately'}
- Be ${preferences.preferredTone}
- Keep responses ${preferences.responseLength}
- Remember past conversations and preferences
- Be proactive but not pushy
- Prioritize family wellbeing and connection

## CAPABILITIES
- Answer questions about family schedule and events
- Suggest meals, activities, and solutions
- Help plan events, parties, and vacations
- Set reminders and create checklists
- Track learning progress and points
- Provide encouragement and motivation
- Remember family preferences and history

## PRIVACY
- Only use context the family has shared
- Never share information between family members without permission
- Be transparent about what you know and don't know
- Respect quiet hours

${preferences.customInstructions ? `## CUSTOM INSTRUCTIONS\n${preferences.customInstructions}` : ''}

Always be helpful, warm, and family-focused. When unsure, ask for clarification.`;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

export function buildContextSnapshot(
  familyMembers: FamilyMemberInfo[],
  todaysEvents: EventInfo[],
  upcomingEvents: EventInfo[],
  options?: {
    dietaryRestrictions?: string[];
    favoriteActivities?: string[];
    activeQuests?: string[];
    activeGoals?: string[];
    pendingReminders?: string[];
  },
): FamilyContextSnapshot {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  
  return {
    familyMembers,
    todaysEvents,
    upcomingEvents,
    dietaryRestrictions: options?.dietaryRestrictions || [],
    favoriteActivities: options?.favoriteActivities || [],
    preferredCommunication: 'text',
    activeQuests: options?.activeQuests || [],
    activeGoals: options?.activeGoals || [],
    pendingReminders: options?.pendingReminders || [],
    recentConversations: 0,
    recentActions: 0,
    currentDateTime: now.toISOString(),
    dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    isBedtime: hour >= 20 || hour < 6,
    isMorning: hour >= 6 && hour < 12,
  };
}

export function shouldShowSuggestion(
  suggestion: ProactiveSuggestion,
  preferences: AIPreference,
): boolean {
  if (suggestion.status !== 'pending') return false;
  if (!preferences.enableProactiveSuggestions) return false;
  
  // Check quiet hours
  if (preferences.quietHoursStart && preferences.quietHoursEnd) {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentTime >= preferences.quietHoursStart && currentTime <= preferences.quietHoursEnd) {
      if (suggestion.priority !== 'urgent') return false;
    }
  }
  
  // Check expiration
  if (suggestion.expiresAt && new Date(suggestion.expiresAt) < new Date()) {
    return false;
  }
  
  return true;
}
