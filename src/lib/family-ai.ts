import { getPB } from '@/lib/pb';
import type {
  Conversation,
  ConversationMessage,
  ProactiveSuggestion,
  AIPreference,
  FamilyContextSnapshot,
  MessageRole,
  IntentType,
  ActionType,
} from '@/db/features/family-ai';

/**
 * Get or create a conversation for a user.
 */
export async function getActiveConversation(userId: string): Promise<Conversation | null> {
  const pb = getPB();
  
  try {
    const conversations = await pb.collection('conversations').getList<Conversation>(1, 1, {
      filter: `userId = "${userId}" && isActive = true`,
      sort: '-lastMessageAt',
    });
    
    if (conversations.items.length > 0) {
      return conversations.items[0];
    }
    
    // Create new conversation
    const conversation = await pb.collection('conversations').create<Conversation>({
      userId,
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      messageCount: 0,
      actionCount: 0,
      isActive: true,
    });
    
    return conversation;
  } catch (error) {
    console.error('Failed to get active conversation:', error);
    return null;
  }
}

/**
 * Get conversation history.
 */
export async function getConversationHistory(conversationId: string): Promise<ConversationMessage[]> {
  const pb = getPB();
  
  try {
    const messages = await pb.collection('conversation_messages').getFullList<ConversationMessage>({
      filter: `conversationId = "${conversationId}"`,
      sort: 'created',
    });
    
    return messages;
  } catch (error) {
    console.error('Failed to get conversation history:', error);
    return [];
  }
}

/**
 * Add a message to a conversation.
 */
export async function addMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata?: {
    intentType?: IntentType;
    intentConfidence?: number;
    actions?: any[];
    contextUsed?: string[];
    promptTokens?: number;
    completionTokens?: number;
  }
): Promise<ConversationMessage | null> {
  const pb = getPB();
  
  try {
    const message = await pb.collection('conversation_messages').create<ConversationMessage>({
      conversationId,
      role,
      content,
      ...metadata,
    });
    
    // Update conversation
    const conversation = await pb.collection('conversations').getOne<Conversation>(conversationId);
    await pb.collection('conversations').update(conversationId, {
      lastMessageAt: new Date().toISOString(),
      messageCount: conversation.messageCount + 1,
      actionCount: conversation.actionCount + (metadata?.actions?.length || 0),
    });
    
    return message;
  } catch (error) {
    console.error('Failed to add message:', error);
    return null;
  }
}

/**
 * Get AI preferences for a user.
 */
export async function getAIPreferences(userId: string): Promise<AIPreference | null> {
  const pb = getPB();
  
  try {
    const prefs = await pb.collection('ai_preferences').getList<AIPreference>(1, 1, {
      filter: `userId = "${userId}"`,
    });
    
    return prefs.items[0] || null;
  } catch (error) {
    console.error('Failed to get AI preferences:', error);
    return null;
  }
}

/**
 * Get pending proactive suggestions for a user.
 */
export async function getPendingSuggestions(userId: string): Promise<ProactiveSuggestion[]> {
  const pb = getPB();
  
  try {
    const suggestions = await pb.collection('proactive_suggestions').getFullList<ProactiveSuggestion>({
      filter: `userId = "${userId}" && status = "pending"`,
      sort: '-priority, created',
    });
    
    return suggestions;
  } catch (error) {
    console.error('Failed to get pending suggestions:', error);
    return [];
  }
}

/**
 * Create a proactive suggestion.
 */
export async function createSuggestion(
  userId: string,
  data: {
    title: string;
    message: string;
    emoji?: string;
    triggerType: string;
    triggerData?: any;
    actions: any[];
    priority: 'low' | 'medium' | 'high' | 'urgent';
    expiresAt?: string;
  }
): Promise<ProactiveSuggestion | null> {
  const pb = getPB();
  
  try {
    const suggestion = await pb.collection('proactive_suggestions').create<ProactiveSuggestion>({
      userId,
      title: data.title,
      message: data.message,
      emoji: data.emoji || '💡',
      triggerType: data.triggerType,
      triggerData: data.triggerData,
      actions: data.actions,
      status: 'pending',
      priority: data.priority,
      shownAt: new Date().toISOString(),
      expiresAt: data.expiresAt,
    });
    
    return suggestion;
  } catch (error) {
    console.error('Failed to create suggestion:', error);
    return null;
  }
}

/**
 * Update suggestion status (accepted, dismissed, snoozed).
 */
export async function updateSuggestionStatus(
  suggestionId: string,
  status: 'accepted' | 'dismissed' | 'snoozed',
  snoozedUntil?: string
): Promise<boolean> {
  const pb = getPB();
  
  try {
    const updateData: any = { status };
    if (status === 'snoozed' && snoozedUntil) {
      updateData.snoozedUntil = snoozedUntil;
    }
    
    await pb.collection('proactive_suggestions').update(suggestionId, updateData);
    return true;
  } catch (error) {
    console.error('Failed to update suggestion:', error);
    return false;
  }
}

/**
 * Parse user intent from message content.
 */
export function parseIntent(content: string): {
  intentType: IntentType;
  confidence: number;
  mentionedMembers?: string[];
  referencedDates?: string[];
} {
  const lower = content.toLowerCase();
  
  // Question patterns
  if (lower.includes('when') || lower.includes('what') || lower.includes('how') || lower.includes('where')) {
    return { intentType: 'question', confidence: 0.8 };
  }
  
  // Action patterns
  if (lower.includes('add') || lower.includes('create') || lower.includes('set') || lower.includes('remind')) {
    return { intentType: 'action', confidence: 0.9 };
  }
  
  // Suggestion patterns
  if (lower.includes('suggest') || lower.includes('recommend') || lower.includes('what should')) {
    return { intentType: 'suggestion', confidence: 0.85 };
  }
  
  // Planning patterns
  if (lower.includes('plan') || lower.includes('schedule') || lower.includes('organize')) {
    return { intentType: 'planning', confidence: 0.75 };
  }
  
  // Check-in patterns
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('good morning') || lower.includes('how are you')) {
    return { intentType: 'check_in', confidence: 0.9 };
  }
  
  // Feedback patterns
  if (lower.includes('thank') || lower.includes('great') || lower.includes('awesome') || lower.includes('helpful')) {
    return { intentType: 'feedback', confidence: 0.7 };
  }
  
  return { intentType: 'other', confidence: 0.5 };
}

/**
 * Build family context snapshot for AI.
 */
export async function buildFamilyContext(userId: string): Promise<FamilyContextSnapshot> {
  const pb = getPB();
  
  try {
    // Get family members
    const members = await pb.collection('users').getFullList({
      filter: `familyId != ""`,
    });
    
    // Get today's events
    const today = new Date().toISOString().split('T')[0];
    const events = await pb.collection('calendar_events').getFullList({
      filter: `date = "${today}"`,
      sort: 'time',
    });
    
    // Get upcoming events (next 7 days)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const upcoming = await pb.collection('calendar_events').getFullList({
      filter: `date > "${today}" && date <= "${nextWeek.toISOString().split('T')[0]}"`,
      sort: 'date, time',
    });
    
    // Get active reminders
    const reminders = await pb.collection('reminders').getFullList({
      filter: `status = "active" && userId = "${userId}"`,
    });
    
    return {
      familyMembers: members.map((m: any) => ({
        id: m.id,
        name: m.name,
        role: m.role || 'parent',
        age: m.age,
      })),
      todaysEvents: events.map((e: any) => ({
        id: e.id,
        title: e.title,
        time: e.time,
        location: e.location,
      })),
      upcomingEvents: upcoming.map((e: any) => ({
        id: e.id,
        title: e.title,
        time: e.time,
        location: e.location,
      })),
      pendingReminders: reminders.map((r: any) => r.title),
      activeGoals: [],
      activeQuests: [],
      dietaryRestrictions: [],
      favoriteActivities: [],
      preferredCommunication: 'text',
      recentConversations: 0,
      recentActions: 0,
      currentDateTime: new Date().toISOString(),
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()],
      isWeekend: [0, 6].includes(new Date().getDay()),
      isBedtime: new Date().getHours() >= 20 || new Date().getHours() < 6,
      isMorning: new Date().getHours() >= 6 && new Date().getHours() < 12,
      weatherCondition: undefined,
      temperature: undefined,
    };
  } catch (error) {
    console.error('Failed to build family context:', error);
    return {
      familyMembers: [],
      todaysEvents: [],
      upcomingEvents: [],
      pendingReminders: [],
      activeGoals: [],
      activeQuests: [],
      dietaryRestrictions: [],
      favoriteActivities: [],
      preferredCommunication: 'text',
      recentConversations: 0,
      recentActions: 0,
      currentDateTime: new Date().toISOString(),
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()],
      isWeekend: [0, 6].includes(new Date().getDay()),
      isBedtime: new Date().getHours() >= 20 || new Date().getHours() < 6,
      isMorning: new Date().getHours() >= 6 && new Date().getHours() < 12,
    };
  }
}
