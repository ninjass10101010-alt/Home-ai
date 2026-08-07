/**
 * Enhanced Consuela AI with Conflict Detection, Auto-Buffer, and Active Clarification
 * This extends the existing family-ai.ts with Nori-inspired features
 */

import { analyzeMessageAmbiguity, buildClarificationRequest } from './active-clarification';
import { wouldConflict } from './conflict-detection';
import { suggestBuffers, createBufferEvents } from './auto-buffer-scheduling';
import { getPB } from './pb';
import type { ClarificationRequest } from './active-clarification';
import type { Conflict } from './conflict-detection';

export interface EnhancedAIResponse {
  reply: string;
  clarification?: ClarificationRequest;
  conflicts?: Conflict[];
  buffers?: any[];
  actions?: any[];
}

/**
 * Enhanced AI processing with conflict detection and clarification
 */
export async function processMessageWithClarification(
  message: string,
  userId: string
): Promise<EnhancedAIResponse> {
  const pb = getPB();

  // Get family context
  const familyMembers = await pb.collection('consuela_family_members').getFullList({
    requestKey: null,
  });

  const savedLocations = await pb.collection('consuela_saved_locations').getFullList({
    requestKey: null,
  });

  // Step 1: Check for ambiguity
  const ambiguity = analyzeMessageAmbiguity(message, {
    familyMembers: familyMembers.map((m: any) => ({
      name: m.name,
      id: m.id,
      role: m.role,
    })),
    savedLocations: savedLocations.map((l: any) => ({
      name: l.name,
      address: l.address,
    })),
  });

  // If ambiguous, return clarification request
  if (ambiguity.isAmbiguous) {
    const clarification = buildClarificationRequest(message, ambiguity);

    return {
      reply: `💭 I need a bit more information to help you with that.`,
      clarification: clarification || undefined,
      actions: [],
    };
  }

  // Step 2: Parse intent and extract event details
  const intent = parseIntent(message);

  // Step 3: If creating an event, check for conflicts
  if (intent.type === 'action' && intent.action === 'create_event') {
    const eventDetails = extractEventDetails(message);

    if (eventDetails.start && eventDetails.end) {
      const conflictResult = await wouldConflict({
        newEvent: eventDetails,
        travelTimeMinutes: 15,
      });

      if (conflictResult.hasConflict) {
        return {
          reply: `${conflictResult.summary}\n\n${conflictResult.conflicts.map(c => c.message).join('\n\n')}`,
          conflicts: conflictResult.conflicts,
          actions: [],
        };
      }

      // Step 4: If no conflicts, suggest buffers
      const { buffers, totalBufferTime } = await suggestBuffers(eventDetails);

      if (buffers.length > 0) {
        return {
          reply: `✅ I can create that event for you. I'll also add ${buffers.length} buffer${buffers.length > 1 ? 's' : ''} (${totalBufferTime} min total) to give you travel time and preparation time.`,
          buffers,
          actions: [
            {
              type: 'create_event',
              data: eventDetails,
            },
            {
              type: 'create_buffers',
              data: buffers,
            },
          ],
        };
      }
    }
  }

  // Default: pass through to existing AI
  return {
    reply: '',
    actions: [],
  };
}

/**
 * Parse user intent from message
 */
function parseIntent(message: string): {
  type: 'question' | 'action' | 'suggestion' | 'planning' | 'check_in' | 'feedback' | 'other';
  action?: string;
} {
  const lower = message.toLowerCase();

  // Action patterns
  if (lower.includes('add') || lower.includes('create') || lower.includes('schedule')) {
    return { type: 'action', action: 'create_event' };
  }

  // Question patterns
  if (lower.includes('when') || lower.includes('what') || lower.includes('how')) {
    return { type: 'question' };
  }

  return { type: 'other' };
}

/**
 * Extract event details from natural language
 */
function extractEventDetails(message: string): {
  summary: string;
  start: string;
  end: string;
  location?: string;
  attendees?: { email: string }[];
} {
  // Simple extraction - in production, use NLP or AI
  const lower = message.toLowerCase();

  // Extract title (first noun phrase after "add/create/schedule")
  let summary = 'New Event';
  const titleMatch = message.match(/(?:add|create|schedule)\s+(.+?)(?:\s+(?:for|on|at|from)\s+|$)/i);
  if (titleMatch) {
    summary = titleMatch[1].trim();
  }

  // Extract time (simple pattern matching)
  const now = new Date();
  let start = now.toISOString();
  let end = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // Default 1 hour

  // "tomorrow at 3pm"
  const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tomorrowMatch) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let hour = parseInt(tomorrowMatch[1]);
    const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const period = tomorrowMatch[3]?.toLowerCase();

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    tomorrow.setHours(hour, minute, 0, 0);
    start = tomorrow.toISOString();
    end = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString();
  }

  // "today at 5pm"
  const todayMatch = lower.match(/today\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (todayMatch) {
    const today = new Date(now);
    let hour = parseInt(todayMatch[1]);
    const minute = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
    const period = todayMatch[3]?.toLowerCase();

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    today.setHours(hour, minute, 0, 0);
    start = today.toISOString();
    end = new Date(today.getTime() + 60 * 60 * 1000).toISOString();
  }

  return {
    summary,
    start,
    end,
  };
}

/**
 * Execute actions from AI response
 */
export async function executeAIActions(actions: any[]): Promise<{
  success: number;
  failed: number;
  results: any[];
}> {
  let success = 0;
  let failed = 0;
  const results: any[] = [];

  for (const action of actions) {
    try {
      if (action.type === 'create_event') {
        const { createCalendarEvent } = await import('./google/calendar');
        const event = await createCalendarEvent(action.data);
        results.push({ type: 'event', data: event });
        success++;
      } else if (action.type === 'create_buffers') {
        const { created, errors } = await createBufferEvents(
          action.data,
          'AI-generated event'
        );
        results.push({ type: 'buffers', created, errors });
        success += created;
        failed += errors;
      }
    } catch (error) {
      console.error('Failed to execute action:', error);
      failed++;
      results.push({ type: 'error', error });
    }
  }

  return { success, failed, results };
}
